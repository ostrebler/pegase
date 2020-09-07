import { Internals, Options, Parser } from ".";
import { buildSafeMatch, inferChildren, SemanticAction } from "../match";

export class Alternative<TContext> extends Parser<TContext> {
  private readonly parsers: Array<Parser<TContext>>;

  constructor(
    parsers: Array<Parser<TContext>>,
    action?: SemanticAction<TContext>
  ) {
    super(action);
    this.parsers = parsers;
  }

  _parse(
    input: string,
    options: Options<TContext>,
    internals: Internals<TContext>
  ) {
    for (const parser of this.parsers) {
      const match = parser._parse(input, options, internals);
      if (match)
        return buildSafeMatch(
          input,
          match.from,
          match.to,
          inferChildren([match]),
          this.action,
          options,
          internals
        );
    }
    return null;
  }
}
