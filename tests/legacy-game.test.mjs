import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, activeWeights, randomInt, randomSector, SECTORS, targetRotation, targetDice } from '../lib/roulette.ts';
import { motionSounds, soundSamples, inverseEase } from '../lib/game-audio.ts';

function tickets(...values) {
  return { getRandomValues(array) { assert.ok(values.length, 'RNG fixture exhausted'); array[0] = values.shift(); return array; } };
}
const mod360 = n => ((n % 360) + 360) % 360;

test('default campaign-free distribution is three gifts and one of each other kind', () => {
  const kinds = SECTORS.reduce((a, s) => ({ ...a, [s.kind]: (a[s.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { brinde: 3, retry: 1, super: 1, miss: 1 });
  assert.deepEqual(activeWeights(DEFAULT_CONFIG), [3, 1, 1, 1]);
  const outcomes = Array.from({ length: 6 }, (_, ticket) => SECTORS[randomSector([3,1,1,1], tickets(ticket, 0))].kind);
  assert.deepEqual(outcomes, ['brinde', 'brinde', 'brinde', 'retry', 'miss', 'super']);
  assert.equal(new Set([0,1,2].map(n => randomSector([3,0,0,0], tickets(0,n)))).size, 3);
});

test('configured weights exclude zero categories and invalid inputs do not draw', () => {
  assert.equal(SECTORS[randomSector([0,0,0,1], tickets(0))].kind, 'super');
  for (const weights of [[0,0,0,0], [1,1,1], [-1,1,1,1], [101,1,1,1], [NaN,1,1,1]]) {
    assert.throws(() => randomSector(weights, tickets(0)));
  }
});

test('secure integer sampling rejects the biased tail and unavailable crypto', () => {
  assert.equal(randomInt(6, tickets(4294967295, 5)), 5);
  assert.throws(() => randomInt(6, {}));
  assert.throws(() => randomInt(0, tickets(0)));
});

test('device settings are bounded and defaults remain unchanged', () => {
  const before = structuredClone(DEFAULT_CONFIG);
  const config = normalizeConfig({ wheelSeconds: 100, diceSeconds: -1, soundVolume: NaN, weights: [101,-1,2,NaN] });
  assert.equal(config.wheelSeconds, 30); assert.equal(config.diceSeconds, 2); assert.equal(config.soundVolume, 60);
  assert.deepEqual(config.weights, [100,0,2,1]);
  config.weights[0] = 0;
  assert.deepEqual(DEFAULT_CONFIG, before);
});

test('wheel settles under the pointer for all six sectors and repeated draws', () => {
  for (const start of [0, 359, 8100, -30]) for (let face=0; face<6; face++) for (const seconds of [3,12,30]) {
    const end=targetRotation(start,face,seconds);
    assert.ok(end>start+360*5);
    assert.equal(mod360(end), mod360(-face*60));
  }
});

test('each die target brings its face normal to the front', () => {
  const normals=[[0,0,1],[1,0,0],[0,0,-1],[-1,0,0],[0,-1,0],[0,1,0]];
  for (const current of [{x:0,y:0},{x:2000,y:3000},{x:-120,y:30}]) normals.forEach(([x,y,z],face) => {
    const target=targetDice(current,face), ry=target.y*Math.PI/180, rx=target.x*Math.PI/180;
    const afterY=[Math.cos(ry)*x+Math.sin(ry)*z,y,-Math.sin(ry)*x+Math.cos(ry)*z];
    const front=Math.sin(rx)*afterY[1]+Math.cos(rx)*afterY[2];
    assert.ok(Math.abs(front-1)<1e-9, `face ${face+1} does not face front`);
  });
});

test('wheel audio clicks align with sector boundaries along the configured easing', () => {
  const events=motionSounds('wheel',[
    {offset:0,transform:'rotate(0deg)',easing:'linear'},
    {offset:1,transform:'rotate(360deg)'}
  ],6);
  assert.deepEqual(events.map(e=>e.time), [.5,1.5,2.5,3.5,4.5,5.5]);
  for (const curve of ['ease-in','ease-out','cubic-bezier(.55,0,.8,.6)']) {
    const values=Array.from({length:101},(_,i)=>inverseEase(i/100,curve));
    assert.equal(values[0],0);assert.equal(values.at(-1),1);
    assert.ok(values.every((v,i)=>v>=0&&v<=1&&(!i||v>=values[i-1])));
  }
});

test('synthesized effects are finite, bounded, and end at silence', () => {
  for (const kind of ['wheel','dice','bell']) for (const rate of [44100,48000]) {
    const samples=soundSamples(kind,1,rate);
    assert.ok(samples.length>0);assert.equal(samples[0],0);assert.equal(samples.at(-1),0);
    assert.ok(samples.every(n=>Number.isFinite(n)&&Math.abs(n)<=.851));
  }
});
