import { z } from 'zod';

export const userProfileSchema = z
  .object({
    id: z.number().int(),
    username: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  })
  .meta({ id: 'UserProfile' });
export type UserProfile = z.infer<typeof userProfileSchema>;

export const cartItemSchema = z.object({
  productId: z.number().int(),
  title: z.string(),
  quantity: z.number().int(),
  unitPrice: z.number(),
  total: z.number(),
  discountedTotal: z.number(),
});

export const cartSchema = z
  .object({
    id: z.number().int(),
    items: z.array(cartItemSchema),
    totalItems: z.number().int(),
    total: z.number(),
    discountedTotal: z.number(),
  })
  .meta({ id: 'Cart' });
export type Cart = z.infer<typeof cartSchema>;

export const cartListSchema = z.object({ data: z.array(cartSchema) });

export const userIdParams = z.object({
  id: z.coerce.number().int().positive().describe('User id'),
});

const enrichedItemSchema = cartItemSchema.extend({
  product: z
    .object({
      category: z.string(),
      brand: z.string().nullable(),
      rating: z.number(),
      inStock: z.boolean(),
      thumbnail: z.string(),
    })
    .nullable()
    .describe('null when product details could not be fetched'),
});

export const userSummarySchema = z
  .object({
    user: userProfileSchema,
    carts: z
      .array(cartSchema.extend({ items: z.array(enrichedItemSchema) }))
      .nullable()
      .describe('null when the carts service was unavailable'),
    stats: z
      .object({
        cartCount: z.number().int(),
        totalItems: z.number().int(),
        totalSpent: z.number(),
        totalSaved: z.number(),
        topCategories: z.array(z.object({ category: z.string(), quantity: z.number().int() })),
      })
      .nullable(),
    partial: z.boolean().describe('true when at least one dependency failed'),
    errors: z.array(z.object({ source: z.string(), message: z.string() })),
  })
  .meta({ id: 'UserSummary' });
export type UserSummary = z.infer<typeof userSummarySchema>;
