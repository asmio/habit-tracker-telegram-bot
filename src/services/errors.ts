/** The requested row does not exist or belongs to another user; callers cannot (and should not) tell which. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
