import { z } from 'zod';

/**
 * Anti-corruption layer: we validate only the upstream fields we rely on.
 * Zod strips unknown keys, so sensitive upstream fields (e.g. DummyJSON's
 * plaintext `password` on users) can never leak through the gateway.
 */
export const upstreamProductSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  price: z.number(),
  discountPercentage: z.number(),
  rating: z.number(),
  stock: z.number().int(),
  brand: z.string().optional(),
  tags: z.array(z.string()).default([]),
  thumbnail: z.string(),
  images: z.array(z.string()).default([]),
  availabilityStatus: z.string().optional(),
});
export type UpstreamProduct = z.infer<typeof upstreamProductSchema>;

export const upstreamProductPageSchema = z.object({
  products: z.array(upstreamProductSchema),
  total: z.number().int(),
  skip: z.number().int(),
  limit: z.number().int(),
});
export type UpstreamProductPage = z.infer<typeof upstreamProductPageSchema>;

export const upstreamCategoriesSchema = z.array(z.object({ slug: z.string(), name: z.string() }));

export const upstreamUserSchema = z.object({
  id: z.number().int(),
  firstName: z.string(),
  lastName: z.string(),
  username: z.string(),
  email: z.string(),
  gender: z.string().optional(),
  image: z.string().optional(),
  role: z.string().optional(),
});
export type UpstreamUser = z.infer<typeof upstreamUserSchema>;

export const upstreamCartSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  products: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      price: z.number(),
      quantity: z.number().int(),
      total: z.number(),
      discountPercentage: z.number(),
      discountedTotal: z.number(),
      thumbnail: z.string().optional(),
    }),
  ),
  total: z.number(),
  discountedTotal: z.number(),
  totalProducts: z.number().int(),
  totalQuantity: z.number().int(),
});
export type UpstreamCart = z.infer<typeof upstreamCartSchema>;

export const upstreamCartsSchema = z.object({
  carts: z.array(upstreamCartSchema),
  total: z.number().int(),
});

export const upstreamLoginSchema = upstreamUserSchema.omit({ role: true }).extend({
  accessToken: z.string(),
});
export type UpstreamLogin = z.infer<typeof upstreamLoginSchema>;
