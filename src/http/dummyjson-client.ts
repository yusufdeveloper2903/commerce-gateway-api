import { NotFoundError, UnauthorizedError, UpstreamHttpError } from '../lib/errors.js';
import {
  upstreamCartsSchema,
  upstreamCategoriesSchema,
  upstreamLoginSchema,
  upstreamProductPageSchema,
  upstreamProductSchema,
  upstreamUserSchema,
  type UpstreamCart,
  type UpstreamLogin,
  type UpstreamProduct,
  type UpstreamProductPage,
  type UpstreamUser,
} from './dummyjson.schemas.js';
import type { HttpClient } from './upstream-client.js';

export interface ProductQuery {
  limit: number;
  skip: number;
  q?: string | undefined;
  category?: string | undefined;
  sortBy?: string | undefined;
  order?: 'asc' | 'desc' | undefined;
}

/** Typed facade over DummyJSON. Translates upstream 404/400 into domain errors. */
export class DummyJsonClient {
  constructor(private readonly http: HttpClient) {}

  listProducts(query: ProductQuery): Promise<UpstreamProductPage> {
    const { q, category, ...rest } = query;
    const path = q
      ? '/products/search'
      : category
        ? `/products/category/${encodeURIComponent(category)}`
        : '/products';
    return this.http.request(
      { path, endpoint: 'products.list', query: { ...rest, ...(q ? { q } : {}) } },
      upstreamProductPageSchema,
    );
  }

  listCategories(): Promise<{ slug: string; name: string }[]> {
    return this.http.request(
      { path: '/products/categories', endpoint: 'products.categories' },
      upstreamCategoriesSchema,
    );
  }

  getProduct(id: number): Promise<UpstreamProduct> {
    return this.notFoundAs(
      this.http.request(
        { path: `/products/${id}`, endpoint: 'products.get' },
        upstreamProductSchema,
      ),
      `Product ${id} not found`,
    );
  }

  getUser(id: number): Promise<UpstreamUser> {
    return this.notFoundAs(
      this.http.request({ path: `/users/${id}`, endpoint: 'users.get' }, upstreamUserSchema),
      `User ${id} not found`,
    );
  }

  async getUserCarts(userId: number): Promise<UpstreamCart[]> {
    const res = await this.http.request(
      { path: `/carts/user/${userId}`, endpoint: 'carts.byUser' },
      upstreamCartsSchema,
    );
    return res.carts;
  }

  async login(username: string, password: string): Promise<UpstreamLogin> {
    try {
      return await this.http.request(
        {
          method: 'POST',
          path: '/auth/login',
          endpoint: 'auth.login',
          body: { username, password, expiresInMins: 5 },
        },
        upstreamLoginSchema,
      );
    } catch (error) {
      if (error instanceof UpstreamHttpError && [400, 401].includes(error.upstreamStatus)) {
        throw new UnauthorizedError('Invalid username or password');
      }
      throw error;
    }
  }

  private async notFoundAs<T>(promise: Promise<T>, message: string): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof UpstreamHttpError && [400, 404].includes(error.upstreamStatus)) {
        throw new NotFoundError(message);
      }
      throw error;
    }
  }
}
