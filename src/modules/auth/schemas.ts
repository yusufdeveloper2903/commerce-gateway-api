import { z } from 'zod';
import { userProfileSchema } from '../users/schemas.js';

export const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().describe('Token lifetime in seconds'),
  user: userProfileSchema,
});
