import assign from "lodash/assign";
import {
  EdgeType,
  ExpectationType,
  extendFlags,
  Failure,
  FailureType,
  Internals,
  Match,
  mergeFailures,
  ParseOptions,
  preskip,
  Result,
  SemanticAction
} from ".";

export abstract class Parser<Value, Context> {
  abstract exec(
    options: ParseOptions<Context>,
    internals: Internals
  ): Match<Value> | null;

  parse(
    input: string,
    options?: Partial<ParseOptions<Context>>
  ): Result<Value> {
    const fullOptions = {
      input,
      from: 0,
      skipper: spaces,
      skip: true,
      ignoreCase: false,
      context: (undefined as unknown) as Context,
      ...options
    };
    const internals = {
      warnings: [],
      failures: [],
      committedFailures: []
    };
    const match = this.exec(fullOptions, internals);
    const common = {
      warnings: internals.warnings,
      failures: [
        ...internals.committedFailures,
        mergeFailures(internals.failures)
      ]
    };
    return {
      ...common,
      ...(!match
        ? { success: false }
        : {
            ...match,
            success: true,
            raw: fullOptions.input.substring(match.from, match.to)
          })
    };
  }
}

// LiteralParser

export class LiteralParser<
  Value extends string | undefined,
  Context
> extends Parser<Value, Context> {
  readonly literal: string;
  readonly emit: Value extends string ? true : false;

  constructor(literal: string, emit: Value extends string ? true : false) {
    super();
    this.literal = literal;
    this.emit = emit;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const cursor = preskip(options, internals);
    if (cursor === null) return null;
    const to = cursor + this.literal.length;
    const raw = options.input.substring(cursor, to);
    const result = options.ignoreCase
      ? this.literal.toUpperCase() === raw.toUpperCase()
      : this.literal === raw;
    if (result)
      return {
        from: cursor,
        to,
        value: (this.emit ? raw : undefined) as Value,
        captures: Object.create(null)
      };
    internals.failures.push({
      from: cursor,
      to: cursor,
      type: FailureType.Expectation,
      expected: [{ type: ExpectationType.Literal, literal: this.literal }]
    });
    return null;
  }
}

// RegExpParser

export class RegExpParser<Context> extends Parser<string, Context> {
  readonly regExp: RegExp;
  private readonly withCase: RegExp;
  private readonly withoutCase: RegExp;

  constructor(regExp: RegExp) {
    super();
    this.regExp = regExp;
    this.withCase = extendFlags(regExp, "y");
    this.withoutCase = extendFlags(regExp, "iy");
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const cursor = preskip(options, internals);
    if (cursor === null) return null;
    const regExp = options.ignoreCase ? this.withoutCase : this.withCase;
    regExp.lastIndex = cursor;
    const result = regExp.exec(options.input);
    if (result !== null)
      return {
        from: cursor,
        to: cursor + result[0].length,
        value: result[0],
        captures: result.groups ?? Object.create(null)
      };
    internals.failures.push({
      from: cursor,
      to: cursor,
      type: FailureType.Expectation,
      expected: [{ type: ExpectationType.RegExp, regExp: this.regExp }]
    });
    return result;
  }
}

// EdgeParser

export abstract class EdgeParser<Context> extends Parser<undefined, Context> {
  readonly edge: EdgeType;

  protected constructor(edge: EdgeType) {
    super();
    this.edge = edge;
  }
}

// StartEdgeParser

export class StartEdgeParser<Context> extends EdgeParser<Context> {
  constructor() {
    super(EdgeType.Start);
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    if (options.from === 0)
      return {
        from: 0,
        to: 0,
        value: undefined,
        captures: Object.create(null)
      };
    internals.failures.push({
      from: options.from,
      to: options.from,
      type: FailureType.Expectation,
      expected: [{ type: ExpectationType.Edge, edge: EdgeType.Start }]
    });
    return null;
  }
}

// EndEdgeParser

export class EndEdgeParser<Context> extends EdgeParser<Context> {
  constructor() {
    super(EdgeType.End);
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const cursor = preskip(options, internals);
    if (cursor === null) return null;
    if (cursor === options.input.length)
      return {
        from: cursor,
        to: cursor,
        value: undefined,
        captures: Object.create(null)
      };
    internals.failures.push({
      from: cursor,
      to: cursor,
      type: FailureType.Expectation,
      expected: [{ type: ExpectationType.Edge, edge: EdgeType.End }]
    });
    return null;
  }
}

// ReferenceParser

export class ReferenceParser<Value, Context> extends Parser<Value, Context> {
  label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const parser:
      | Parser<Value, Context>
      | undefined = options.grammar?.rules.get(this.label);
    if (!parser)
      throw new Error(
        `Pegase couldn't resolve rule "${this.label}". You need to define it or merge it from another grammar.`
      );
    const match = parser.exec(options, internals);
    if (match === null) return null;
    return {
      ...match,
      captures: assign(Object.create(null), { [this.label]: match.value })
    };
  }
}

// OptionParser

export class OptionParser<Value, Context> extends Parser<Value, Context> {
  readonly parsers: Array<Parser<any, Context>>;

  constructor(parsers: Array<Parser<any, Context>>) {
    super();
    this.parsers = parsers;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    for (const parser of this.parsers) {
      const match = parser.exec(options, internals);
      if (match) return match;
    }
    return null;
  }
}

// SequenceParser

export class SequenceParser<Value extends Array<any>, Context> extends Parser<
  Value,
  Context
> {
  readonly parsers: Array<Parser<Value[number], Context>>;

  constructor(parsers: Array<Parser<Value[number], Context>>) {
    super();
    this.parsers = parsers;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    let from = options.from;
    const matches: Array<Match<Value[number]>> = [];
    for (const parser of this.parsers) {
      const match = parser.exec({ ...options, from }, internals);
      if (match === null) return null;
      from = match.to;
      matches.push(match);
    }
    return {
      from: matches[0].from,
      to: from,
      value: matches
        .map(match => match.value)
        .filter(value => value !== undefined) as Value,
      captures: assign(
        Object.create(null),
        ...matches.map(match => match.captures)
      )
    };
  }
}

// DelegateParser

export abstract class DelegateParser<
  Value,
  Context,
  DValue = Value
> extends Parser<Value, Context> {
  readonly parser: Parser<DValue, Context>;

  protected constructor(parser: Parser<DValue, Context>) {
    super();
    this.parser = parser;
  }
}

// GrammarParser

export class GrammarParser<Value, Context> extends DelegateParser<
  Value,
  Context
> {
  readonly rules: Map<string, Parser<any, Context>>;

  constructor(rules: Map<string, Parser<any, Context>>) {
    super(rules.values().next().value);
    this.rules = rules;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    return this.parser.exec(options, internals);
  }
}

// TokenParser

export class TokenParser<Value, Context> extends DelegateParser<
  Value,
  Context
> {
  alias?: string;

  constructor(parser: Parser<Value, Context>, alias?: string) {
    super(parser);
    this.alias = alias;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const cursor = preskip(options, internals);
    if (cursor === null) return null;
    const failures: Array<Failure> = [];
    const match = this.parser.exec(
      { ...options, from: cursor, skip: false },
      { ...internals, failures }
    );
    if (match) return match;
    internals.failures.push({
      from: cursor,
      to: cursor,
      type: FailureType.Expectation,
      expected: [{ type: ExpectationType.Token, alias: this.alias }]
    });
    return null;
  }
}

// RepetitionParser

export class RepetitionParser<
  Value extends Array<any>,
  Context
> extends DelegateParser<Value, Context, Value[number]> {
  readonly min: number;
  readonly max: number;

  constructor(
    parser: Parser<Value[number], Context>,
    min: number,
    max: number
  ) {
    super(parser);
    this.min = min;
    this.max = max;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    let from = options.from,
      counter = 0;
    const matches: Array<Match<Value[number]>> = [];
    const success = () => ({
      ...(matches.length === 0
        ? { from: options.from, to: options.from }
        : { from: matches[0].from, to: matches[matches.length - 1].to }),
      value: matches.map(match => match.value) as Value,
      captures: assign(
        Object.create(null),
        ...matches.map(match => match.captures)
      )
    });
    while (true) {
      if (counter === this.max) return success();
      const match = this.parser.exec({ ...options, from }, internals);
      if (match) {
        matches.push(match);
        from = match.to;
        counter++;
      } else if (counter < this.min) return null;
      else return success();
    }
  }
}

// OptionMergeParser

export class OptionMergeParser<Value, Context> extends DelegateParser<
  Value,
  Context
> {
  options: Partial<ParseOptions<Context>>;

  constructor(
    parser: Parser<Value, Context>,
    options: Partial<ParseOptions<Context>>
  ) {
    super(parser);
    this.options = options;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    return this.parser.exec({ ...options, ...this.options }, internals);
  }
}

// CaptureParser

export class CaptureParser<Value, Context> extends DelegateParser<
  Value,
  Context
> {
  name: string;

  constructor(parser: Parser<Value, Context>, name: string) {
    super(parser);
    this.name = name;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const match = this.parser.exec(options, internals);
    if (match === null) return null;
    return {
      ...match,
      captures: Object.assign(Object.create(null), match.captures, {
        [this.name]: match.value
      })
    };
  }
}

// ActionParser

export class ActionParser<Value, Context> extends DelegateParser<
  Value,
  Context,
  any
> {
  readonly action: SemanticAction<Value, Context>;

  constructor(
    parser: Parser<any, Context>,
    action: SemanticAction<Value, Context>
  ) {
    super(parser);
    this.action = action;
  }

  exec(options: ParseOptions<Context>, internals: Internals) {
    const match = this.parser.exec(options, internals);
    if (match === null) return null;
    try {
      const value = this.action({
        ...match.captures,
        $options: options,
        $raw: options.input.substring(match.from, match.to),
        $from: match.from,
        $to: match.to,
        $value: match.value,
        $captures: match.captures,
        $commit() {
          internals.committedFailures.push(mergeFailures(internals.failures));
          internals.failures = [];
        },
        $warn(message: string) {
          internals.warnings.push({ from: match.from, to: match.to, message });
        }
      });
      return { ...match, value };
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      internals.failures.push({
        from: match.from,
        to: match.to,
        type: FailureType.Semantic,
        message: e.message
      });
      return null;
    }
  }
}

// Global parsers

export const spaces = new RegExpParser<any>(/\s*/);
export const any = new RegExpParser<any>(/./);
