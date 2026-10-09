import { logger } from './logger';

describe('logger', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each(['debug', 'info', 'warn', 'error'] as const)('%s writes an uppercase-tagged, timestamped line to console.%s', (level) => {
    const spy = jest.spyOn(console, level).mockImplementation(() => undefined);
    logger[level]('something happened');

    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0];
    expect(line).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2}T.*Z ${level.toUpperCase()} something happened$`));
  });

  test('an optional context object is passed through as a second argument', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.warn('careful', { itemId: 5 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ itemId: 5 });
  });

  test('with no context, only the line is passed -- no stray undefined argument', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    logger.info('no context here');

    expect(spy.mock.calls[0]).toHaveLength(1);
  });
});
