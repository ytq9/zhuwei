export type ServerInvocation<T> = {
  data: T;
  userId: string;
};

export class PublicServerError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

type ServerHandler<T, R> = (args: {
  data: T;
  context: { userId: string };
}) => R | Promise<R>;

class ServerFnBuilder<T> {
  constructor(private readonly validate: (input: unknown) => T) {}

  middleware(_middleware: unknown[]) {
    return this;
  }

  validator<Next>(validate: (input: Next) => Next) {
    return new ServerFnBuilder<Next>((input) => validate(input as Next));
  }

  handler<R>(handler: ServerHandler<T, R>) {
    return async ({ data, userId }: ServerInvocation<T>): Promise<R> =>
      handler({ data: this.validate(data), context: { userId } });
  }
}

export function createServerFn(_options: { method: "GET" | "POST" }) {
  return new ServerFnBuilder<undefined>(() => undefined);
}

// Sites API routes authenticate before invoking these functions.
export const authMiddleware = Symbol("sites-chatgpt-auth");
