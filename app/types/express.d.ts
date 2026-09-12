declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'ADMIN' | 'MANAGER' | 'CASHIER';
      };
      override?: {
        userId: string;
        email: string;
        role: 'ADMIN' | 'MANAGER';
      };
    }
  }
}

export {};
