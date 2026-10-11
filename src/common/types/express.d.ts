declare global {
  namespace Express {
    interface Request {
      id?: string;
      traceId?: string;
      correlationId?: string;
      user: {
        id: string;
        email: string;
        role: string;
        roleId?: string;
        permissions?: string[];
      };
      apiKey?: {
        id: string;
        name: string;
        prefix: string;
        permissions?: string[];
      };
    }
  }
}

export {};
