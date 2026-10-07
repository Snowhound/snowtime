import { expect, test } from 'bun:test'
import { rewriteSharedProps } from './shared-props'

function evaluate(body: string) {
  const result = rewriteSharedProps('(function(){' + body + '})()')
  // oxlint-disable-next-line typescript/no-implied-eval -- Exercise generated JavaScript in an isolated function.
  return { ...result, value: new Function('return ' + result.code)() }
}

test('keeps own keys, order, flags, prototype, and lazy live getters', () => {
  const { value, rewritten, descriptors } = evaluate(`
    function createComponent(c,p){return p}
    let current=1, reads=0;
    const make=()=>createComponent(null,{get ["class"](){reads++;return current},fixed:2,get children(){return p.fixed}});
    const p=make(), q=make();
    const before=reads;
    const keys=Object.keys(p);
    const flags=Object.entries(Object.getOwnPropertyDescriptors(p)).map(([k,d])=>[k,'get' in d,d.enumerable,d.configurable]);
    current=3;
    return {before,reads,keys,flags,value:p.class,children:p.children,own:Object.hasOwn(p,"class"),
      proto:Object.getPrototypeOf(p)===Object.prototype,constructor:p.constructor===Object,
      shared:Object.getOwnPropertyDescriptor(p,"class").get===Object.getOwnPropertyDescriptor(q,"class").get,
      spread:Object.fromEntries(Object.entries({...p})),names:Object.getOwnPropertyNames(p),slots:Object.getOwnPropertySymbols({...p}).map(String)};
  `)
  expect(rewritten).toBe(1)
  expect(descriptors).toBe(2)
  expect(value).toEqual({
    before: 0,
    reads: 0,
    keys: ['class', 'fixed', 'children'],
    flags: [
      ['class', true, true, true],
      ['fixed', false, true, true],
      ['children', true, true, true],
    ],
    value: 3,
    children: 2,
    own: true,
    proto: true,
    constructor: true,
    shared: true,
    spread: { class: 3, fixed: 2, children: 2 },
    names: ['class', 'fixed', 'children'],
    // As in Solid 2.0, slots are enumerable symbols, so a spread copies them.
    slots: ['Symbol(class)', 'Symbol(children)'],
  })
})

test('shares one descriptor per getter key across sites', () => {
  const { value, descriptors, rewritten } = evaluate(`
    function createComponent(c,p){return p}
    const a=createComponent(null,{get when(){return 1}});
    const b=createComponent(null,{id:2,get when(){return 3}});
    return [a.when,b.when,Object.getOwnPropertyDescriptor(a,"when").get===Object.getOwnPropertyDescriptor(b,"when").get];
  `)
  expect(rewritten).toBe(2)
  expect(descriptors).toBe(1)
  expect(value).toEqual([1, 3, true])
})

test('merge and split re-home getters to their source and keep undefined fallback', () => {
  const { value } = evaluate(`
    function mergeProps(...sources){}
    function splitProps(props,...keys){}
    function createComponent(c,p){return p}
    let reads=0, latest=4;
    const source=createComponent(null,{fixed:2,get value(){reads++;return latest},get children(){return source.fixed}});
    const merged=mergeProps({value:1},source);
    const [selected,rest]=splitProps(merged,["value"]);
    const [inner]=splitProps(selected,["value"]);
    const [direct,others]=splitProps(source,["value"]);
    const before=reads;
    const copied=Object.defineProperties({},Object.getOwnPropertyDescriptors(direct));
    latest=undefined;
    const fallback=selected.value;
    latest=7;
    return {before,fallback,changed:inner.value,direct:direct.value,children:rest.children,others:others.children,
      keys:Object.keys(rest),own:Object.hasOwn(selected,"value"),mergedFlags:Object.getOwnPropertyDescriptor(merged,"value"),
      splitFlags:Object.getOwnPropertyDescriptor(direct,"value"),copied:copied.value,symbols:Object.getOwnPropertySymbols(others).length};
  `)
  expect(value).toMatchObject({
    before: 0,
    fallback: 1,
    changed: 7,
    direct: 7,
    children: 2,
    others: 2,
    keys: ['fixed', 'children'],
    own: true,
    mergedFlags: { enumerable: true, configurable: false },
    splitFlags: { enumerable: true, configurable: true },
    copied: 7,
    symbols: 1,
  })
})

test('ordinary descriptors, proxies, non-enumerable data, and symbols survive split', () => {
  const { value } = evaluate(`
    function splitProps(props,...keys){}
    const symbol=Symbol();
    const source={a:1,get b(){return this.a}};
    Object.defineProperty(source,"hidden",{value:2});
    source[symbol]=3;
    const proxy=new Proxy(source,{});
    const [a,rest]=splitProps(proxy,["hidden",symbol]);
    return {keys:Object.keys(a),all:Reflect.ownKeys(a).map(String),hidden:a.hidden,symbol:a[symbol],rest:{...rest}};
  `)
  expect(value).toEqual({
    keys: [],
    all: ['hidden', 'Symbol()'],
    hidden: 2,
    symbol: 3,
    rest: { a: 1, b: 1 },
  })
})

test('keeps literals with spreads, setters, methods, and receiver references', () => {
  const { rewritten, skipped } = evaluate(`
    function createComponent(c,p){return p}
    const x={};
    createComponent(null,{...x,get a(){return 1}});
    createComponent(null,{get a(){return 1},set a(v){}});
    createComponent(null,{get a(){return 1},m(){}});
    createComponent(null,{get a(){return this.b},b:1});
    createComponent(null,{get a(){return createComponent(null,{get b(){return 2}}).b}});
  `)
  expect(rewritten).toBe(2)
  expect(skipped).toEqual({ spread: 1, setter: 1, method: 1, receiver: 1 })
})
