import type { DummyJsonClient } from '../../http/dummyjson-client.js';
import type { UpstreamProduct } from '../../http/dummyjson.schemas.js';
import type { Cached, CachedLoader } from '../../lib/cache/cached-loader.js';
import type { ListProductsQuery, Product, ProductList } from './schemas.js';

export function toProduct(p: UpstreamProduct): Product {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category: p.category,
    brand: p.brand ?? null,
    price: p.price,
    discountPercentage: p.discountPercentage,
    finalPrice: Math.round(p.price * (1 - p.discountPercentage / 100) * 100) / 100,
    rating: p.rating,
    stock: p.stock,
    inStock: p.stock > 0,
    tags: p.tags,
    thumbnail: p.thumbnail,
    images: p.images,
  };
}

const CATEGORIES_TTL_MS = 10 * 60_000;

export class ProductService {
  constructor(
    private readonly client: DummyJsonClient,
    private readonly loader: CachedLoader,
  ) {}

  list(query: ListProductsQuery): Promise<Cached<ProductList>> {
    const key = `products:list:${JSON.stringify(query, Object.keys(query).sort())}`;
    return this.loader.load(key, async () => {
      const page = await this.client.listProducts({
        limit: query.limit,
        skip: (query.page - 1) * query.limit,
        q: query.q,
        category: query.category,
        sortBy: query.sortBy,
        order: query.sortBy ? query.order : undefined,
      });
      return {
        data: page.products.map(toProduct),
        meta: {
          page: query.page,
          limit: query.limit,
          total: page.total,
          totalPages: Math.ceil(page.total / query.limit),
        },
      };
    });
  }

  get(id: number): Promise<Cached<Product>> {
    return this.loader.load(`product:${id}`, async () =>
      toProduct(await this.client.getProduct(id)),
    );
  }

  categories(): Promise<Cached<{ slug: string; name: string }[]>> {
    return this.loader.load(
      'products:categories',
      () => this.client.listCategories(),
      CATEGORIES_TTL_MS,
    );
  }
}
