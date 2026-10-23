export const productFixture = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Product ${id}`,
  description: `Description ${id}`,
  category: id % 2 === 0 ? 'beauty' : 'groceries',
  price: 100,
  discountPercentage: 10,
  rating: 4.5,
  stock: 5,
  brand: 'Acme',
  tags: ['tag'],
  thumbnail: `https://cdn.example/${id}.webp`,
  images: [],
  sku: 'IGNORED-BY-GATEWAY',
  ...overrides,
});

export const userFixture = (id: number) => ({
  id,
  firstName: 'Emily',
  lastName: 'Johnson',
  username: 'emilys',
  email: 'emily@example.com',
  password: 'emilyspass',
  gender: 'female',
  image: 'https://dummyjson.com/icon/emilys/128',
  role: 'admin',
});

export const cartsFixture = (userId: number) => ({
  carts: [
    {
      id: 7,
      userId,
      products: [
        {
          id: 1,
          title: 'Product 1',
          price: 10,
          quantity: 2,
          total: 20,
          discountPercentage: 10,
          discountedTotal: 18,
        },
        {
          id: 2,
          title: 'Product 2',
          price: 5,
          quantity: 1,
          total: 5,
          discountPercentage: 0,
          discountedTotal: 5,
        },
      ],
      total: 25,
      discountedTotal: 23,
      totalProducts: 2,
      totalQuantity: 3,
    },
  ],
  total: 1,
  skip: 0,
  limit: 1,
});
