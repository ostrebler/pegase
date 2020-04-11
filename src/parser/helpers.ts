import { Internals } from "../internals";
import { NonTerminal, Options, RegexTerminal } from ".";

/**
 * defaultOptions
 */

export const defaultOptions: Options<any> = {
  from: 0,
  skipper: new RegexTerminal(/\s*/),
  skip: true,
  diagnose: true,
  context: undefined
};

/**
 * function rule
 *
 * Creates a new non-terminal with an undefined child parser
 */

export function rule<TContext>(identity?: string) {
  return new NonTerminal<TContext>(null, "BYPASS", identity || null);
}

/**
 * function token
 *
 * Creates a new token with an undefined child parser
 */

export function token<TContext>(identity?: string) {
  return new NonTerminal<TContext>(null, "TOKEN", identity || null);
}

/**
 * function preskip
 *
 * Tries to skip irrelevant parts of the input (usually whitespaces)
 */

export function preskip<TContext>(
  input: string,
  options: Options<TContext>,
  internals: Internals<TContext>
) {
  if (!options.skip || !options.skipper) return options.from;
  const match = options.skipper._parse(
    input,
    {
      ...options,
      skip: false
    },
    internals
  );
  return match && match.to;
}