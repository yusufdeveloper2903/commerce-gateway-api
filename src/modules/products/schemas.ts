import { z } from 'zod';

export const productSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    description: z.string(),
    category: z.string(),
    brand: z.string().nullable(),
    price: z.number().describe('List price in USD'),
    discountPercentage: z.number(),
    finalPrice: z.number().describe('Price after discount, rounded to cents'),
    rating: z.number(),
    stock: z.number().int(),
    inStock: z.boolean(),
    tags: z.array(z.string()),
    thumbnail: z.string(),
    images: z.array(z.string()),
  })
  .meta({ id: 'Product' });
export type Product = z.infer<typeof productSchema>;

export const productIdParams = z.object({
  id: z.coerce.number().int().positive().describe('Product id'),
});

export const listProductsQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().min(1).max(100).optional().describe('Full-text search'),
    category: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'category must be a lowercase slug')
      .optional()
      .describe('Category slug, see GET /products/categories'),
    sortBy: z.enum(['title', 'price', 'rating', 'stock']).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .refine((q) => !(q.q && q.category), {
    message: 'q and category cannot be combined',
    path: ['category'],
  });
export type ListProductsQuery = z.infer<typeof listProductsQuery>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export const productListSchema = z.object({
  data: z.array(productSchema),
  meta: paginationMetaSchema,
});
export type ProductList = z.infer<typeof productListSchema>;

export const categoryListSchema = z.array(z.object({ slug: z.string(), name: z.string() }));
