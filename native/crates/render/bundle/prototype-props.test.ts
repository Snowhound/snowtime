import { expect, test } from 'bun:test'
import { rewritePrototypeProps } from './prototype-props'

function evaluate(body: string) {
  const result = rewritePrototypeProps('(function(){' + body + '})()')
  // oxlint-disable-next-line typescript/no-implied-eval -- Exercise generated JavaScript in an isolated function.
  return { ...result, value: new Function('return ' + result.code)() }
}
test('keeps getters lazy, captured bindings live, keys ordered, and descriptors re-homed', () => {
  const { value, rewritten } = evaluate(`
    function createComponent(c,p){return p}
    let current=1, reads=0;
    const p=createComponent(null,{get ["class"](){reads++;return current},fixed:2,get children(){return p.fixed}});
    const before=reads;
    const keys=Object.keys(p);
    const descriptors=Object.getOwnPropertyDescriptors(p);
    const copy=Object.defineProperties({},descriptors);
    current=3;
    const own=Object.prototype.hasOwnProperty.call(p,"class");
    return {before,reads,keys,value:copy.class,children:copy.children,own,spread:{...p}};
  `)
  expect(rewritten).toBe(1)
  expect(value).toEqual({
    before: 0,
    reads: 0,
    keys: ['class', 'fixed', 'children'],
    value: 3,
    children: 2,
    own: false,
    spread: { class: 3, fixed: 2, children: 2 },
  })
})
test('merge and split read getters on their source and preserve undefined fallback', () => {
  const { value } = evaluate(`
    function mergeProps(...sources){}
    function splitProps(props,...keys){}
    function createComponent(c,p){return p}
    let reads=0, latest=4;
    const source=createComponent(null,{fixed:2,get value(){reads++;return latest},get children(){return source.fixed}});
    const merged=mergeProps({value:1},source);
    const [selected,rest]=splitProps(merged,["value"]);
    const before=reads;
    const descriptors=Object.getOwnPropertyDescriptors(selected);
    const copied=Object.defineProperties({},descriptors);
    latest=undefined;
    const fallback=copied.value;
    latest=7;
    return {before,fallback,changed:selected.value,children:rest.children,keys:Object.keys(rest),own:Object.prototype.hasOwnProperty.call(selected,"value")};
  `)
  expect(value).toEqual({
    before: 0,
    fallback: 1,
    changed: 7,
    children: 2,
    keys: ['fixed', 'children'],
    own: false,
  })
})
test('ordinary descriptors, proxies, non-enumerable data and symbols survive adapters', () => {
  const { value } = evaluate(`
    function splitProps(props,...keys){}
    const symbol=Symbol();
    const source={a:1};
    Object.defineProperty(source,"hidden",{value:2});
    source[symbol]=3;
    const traps=[];
    const proxy=new Proxy(source,{ownKeys(t){traps.push("keys");return Reflect.ownKeys(t)},getOwnPropertyDescriptor(t,k){traps.push(String(k));return Object.getOwnPropertyDescriptor(t,k)}});
    const [a,rest]=splitProps(proxy,["hidden",symbol]);
    return {keys:Object.keys(a),all:Reflect.ownKeys(a).map(String),hidden:a.hidden,symbol:a[symbol],rest:{...rest},traps:traps.slice(0,4)};
  `)
  expect(value).toEqual({
    keys: [],
    all: ['hidden', 'Symbol()'],
    hidden: 2,
    symbol: 3,
    rest: { a: 1 },
    traps: ['keys', 'a', 'hidden', 'Symbol()'],
  })
})
test('normalizes destructured parameter rest', () => {
  const { value } = evaluate(`
    function createComponent(c,p){return c(p)}
    function Component({a,...rest}){return [a,rest]}
    return createComponent(Component,{get a(){return 1},get b(){return 2}});
  `)
  expect(value).toEqual([1, { b: 2 }])
})
test('skips unsupported literals and rewrites nested sites and static computed keys', () => {
  const result = evaluate(`
    function createComponent(c,p){return p}
    const a=createComponent(null,{...{},get x(){return 1}});
    const b=createComponent(null,{get x(){return this.y}});
    const c=createComponent(null,{get x(){return arguments[0]}});
    const d=createComponent(null,{get x(){return 1},set x(v){}});
    return createComponent(null,{get ["x"](){return createComponent(null,{get y(){return 2}}).y}}).x;
  `)
  expect(result.value).toBe(2)
  expect(result.rewritten).toBe(2)
  expect(result.skipped).toEqual({ spread: 1, receiver: 2, setter: 1 })
})

test('rest destructuring preserves named-getter order and reads each getter once', () => {
  const { value } = evaluate(`
    function createComponent(c,p){return c(p)}
    const reads=[];
    function Component({b,a,...rest}){return {a,b,rest,reads}}
    return createComponent(Component,{
      get a(){reads.push("a");return 1},
      get b(){reads.push("b");return 2},
      get c(){reads.push("c");return 3}
    });
  `)
  expect(value).toEqual({ a: 1, b: 2, rest: { c: 3 }, reads: ['b', 'a', 'c'] })
})

test('cached layouts keep each render source separate and preserve descriptor flags', () => {
  const { value } = evaluate(`
    function mergeProps(...sources){}
    function splitProps(props,...keys){}
    const a=mergeProps({value:1}), b=mergeProps({value:2});
    const [one]=splitProps(a,["value"]), [two]=splitProps(b,["value"]);
    const d=Object.getOwnPropertyDescriptor(one,"value");
    const source={};
    let reads=0;
    Object.defineProperty(source,"hidden",{get(){reads++;return 3},enumerable:false,configurable:false});
    const [hidden]=splitProps(source,["hidden"]);
    const hd=Object.getOwnPropertyDescriptor(hidden,"hidden");
    return {sharedMerge:Object.getPrototypeOf(a)===Object.getPrototypeOf(b),
      sharedSplit:Object.getPrototypeOf(one)===Object.getPrototypeOf(two),
      values:[one.value,two.value],flags:[d.enumerable,d.configurable,hd.enumerable,hd.configurable],
      hiddenKeys:Object.keys(hidden),reads};
  `)
  expect(value).toEqual({
    sharedMerge: true,
    sharedSplit: true,
    values: [1, 2],
    flags: [true, false, false, false],
    hiddenKeys: [],
    reads: 0,
  })
})
test('split data properties remain snapshots while merged properties stay live', () => {
  const { value } = evaluate(`
    function mergeProps(...sources){}
    function splitProps(props,...keys){}
    const source={a:1};
    const [copy]=splitProps(source,["a"]);
    const merged=mergeProps(source);
    source.a=2;
    return [copy.a,merged.a];
  `)
  expect(value).toEqual([1, 2])
})
