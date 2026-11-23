/**
 * A source finished, but some of its lookups failed. Carries the results it did get, so the
 * search keeps them and still reports the failure instead of silently returning less.
 */
export class PartialResultError<T> extends Error {
  constructor(
    message: string,
    readonly results: T[]
  ) {
    super(message);
    this.name = 'PartialResultError';
  }
}
