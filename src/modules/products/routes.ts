import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  categoryListSchema,
  listProductsQuery,
  productIdParams,
  productListSchema,
  productSchema,
} from './schemas.js';

export const productRoutes: FastifyPluginAsyncZod = async (app) => {
  const { productService } = app.deps;

  app.get(
    '/',
    {
      schema: {
        tags: ['products'],
        summary: 'List products with pagination, search, category filter and sorting',
        querystring: listProductsQuery,
        response: { 200: productListSchema },
      },
    },
    async (request, reply) => {
      const result = await productService.list(request.query);
      reply.header('x-cache', result.cache);
      return result.value;
    },
  );

  app.get(
    '/categories',
    {
      schema: {
        tags: ['products'],
        summary: 'List product categories',
        response: { 200: categoryListSchema },
      },
    },
    async (_request, reply) => {
      const result = await productService.categories();
      reply.header('x-cache', result.cache);
      return result.value;
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['products'],
        summary: 'Get a product by id',
        params: productIdParams,
        response: { 200: productSchema },
      },
    },
    async (request, reply) => {
      const result = await productService.get(request.params.id);
      reply.header('x-cache', result.cache);
      return result.value;
    },
  );
};
