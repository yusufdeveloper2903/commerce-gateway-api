import type { DummyJsonClient } from '../../http/dummyjson-client.js';
import type { UpstreamCart, UpstreamUser } from '../../http/dummyjson.schemas.js';
import type { Cached, CachedLoader } from '../../lib/cache/cached-loader.js';
import { settleWithConcurrency } from '../../lib/concurrency.js';
import type { ProductService } from '../products/service.js';
import type { Cart, UserProfile, UserSummary } from './schemas.js';

const CARTS_TTL_MS = 5_000;
const ENRICH_CONCURRENCY = 5;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function toProfile(u: UpstreamUser): UserProfile {
  return {
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: `${u.firstName} ${u.lastName}`,
    email: u.email,
    image: u.image ?? null,
  };
}

function toCart(c: UpstreamCart): Cart {
  return {
    id: c.id,
    items: c.products.map((p) => ({
      productId: p.id,
      title: p.title,
      quantity: p.quantity,
      unitPrice: p.price,
      total: p.total,
      discountedTotal: p.discountedTotal,
    })),
    totalItems: c.totalQuantity,
    total: c.total,
    discountedTotal: c.discountedTotal,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export class UserService {
  constructor(
    private readonly client: DummyJsonClient,
    private readonly loader: CachedLoader,
    private readonly products: ProductService,
  ) {}

  getProfile(id: number): Promise<Cached<UserProfile>> {
    return this.loader.load(`user:${id}`, async () => toProfile(await this.client.getUser(id)));
  }

  getCarts(userId: number): Promise<Cached<Cart[]>> {
    return this.loader.load(
      `carts:user:${userId}`,
      async () => (await this.client.getUserCarts(userId)).map(toCart),
      CARTS_TTL_MS,
    );
  }

  /**
   * Fan-out aggregation: user + carts in parallel, then enrich every distinct
   * cart product with catalogue data (bounded concurrency, cached).
   * The user is mandatory (its failure fails the request); carts and product
   * enrichment degrade gracefully and are reported in `errors`.
   */
  async getSummary(id: number): Promise<UserSummary> {
    const [userResult, cartsResult] = await Promise.allSettled([
      this.getProfile(id),
      this.getCarts(id),
    ]);
    if (userResult.status === 'rejected') throw userResult.reason;

    const errors: UserSummary['errors'] = [];
    if (cartsResult.status === 'rejected') {
      errors.push({ source: 'carts', message: describeError(cartsResult.reason) });
      return { user: userResult.value.value, carts: null, stats: null, partial: true, errors };
    }

    const carts = cartsResult.value.value;
    const productIds = [...new Set(carts.flatMap((c) => c.items.map((i) => i.productId)))];
    const settled = await settleWithConcurrency(productIds, ENRICH_CONCURRENCY, (pid) =>
      this.products.get(pid),
    );

    const details = new Map<
      number,
      NonNullable<UserSummary['carts']>[number]['items'][number]['product']
    >();
    settled.forEach((result, index) => {
      const pid = productIds[index] as number;
      if (result.status === 'fulfilled') {
        const p = result.value.value;
        details.set(pid, {
          category: p.category,
          brand: p.brand,
          rating: p.rating,
          inStock: p.inStock,
          thumbnail: p.thumbnail,
        });
      } else {
        errors.push({ source: `product:${pid}`, message: describeError(result.reason) });
      }
    });

    const enrichedCarts = carts.map((cart) => ({
      ...cart,
      items: cart.items.map((item) => ({ ...item, product: details.get(item.productId) ?? null })),
    }));

    const categoryQty = new Map<string, number>();
    for (const item of enrichedCarts.flatMap((c) => c.items)) {
      if (!item.product) continue;
      categoryQty.set(
        item.product.category,
        (categoryQty.get(item.product.category) ?? 0) + item.quantity,
      );
    }

    return {
      user: userResult.value.value,
      carts: enrichedCarts,
      stats: {
        cartCount: carts.length,
        totalItems: carts.reduce((n, c) => n + c.totalItems, 0),
        totalSpent: round2(carts.reduce((n, c) => n + c.discountedTotal, 0)),
        totalSaved: round2(carts.reduce((n, c) => n + (c.total - c.discountedTotal), 0)),
        topCategories: [...categoryQty]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([category, quantity]) => ({ category, quantity })),
      },
      partial: errors.length > 0,
      errors,
    };
  }
}
