import { NotFoundError } from './errors';

test('is a real Error, named distinctly, with the given message', () => {
  const error = new NotFoundError('Item 5 not found');
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(NotFoundError);
  expect(error.name).toBe('NotFoundError');
  expect(error.message).toBe('Item 5 not found');
});
