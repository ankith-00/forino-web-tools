import { detectPages, scaleQuadsToFrame } from "../src/lib/scanjet/page-detect.ts";
import { toGrayscale, blurGaussian, canny, dilate, connectedComponents, convexHull, hullArea, maxAreaQuad, refineQuadCorners, type Pt } from "../src/lib/scanjet/vision.ts";

function pointIn(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function paint(w: number, h: number, shade: (x: number, y: number) => number | null) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = shade(x, y); const p = (y * w + x) * 4;
    rgba[p] = rgba[p+1] = rgba[p+2] = v ?? 30; rgba[p+3] = 255;
  }
  return rgba;
}

function inspect(label: string, w: number, h: number, rgba: Uint8ClampedArray) {
  const gray = toGrayscale(rgba, w, h);
  const edges = canny(blurGaussian(gray, 2, 3), 50, 150);
  let lit = 0; for (const v of edges.data) if (v > 0) lit++;
  const closed = dilate(edges, 1, 2);
  const comps = connectedComponents(closed, 24);
  console.log(`\n=== ${label} ===`);
  console.log(`canny lit=${lit}  comps=${comps.length} areas=[${comps.map(c=>c.area).join(",")}] frameArea=${w*h} threshold=${(w*h*0.08).toFixed(0)}`);
  for (const [i, c] of comps.entries()) {
    const pts = c.pixels.map(p => ({ x: p % w, y: (p / w) | 0 }));
    const hull = convexHull(pts);
    const ha = hullArea(hull);
    const picked = maxAreaQuad(hull).map(k => hull[k]);
    const refined = refineQuadCorners(picked, pts);
    console.log(`  comp${i}: hullLen=${hull.length} hullArea=${ha.toFixed(0)} (${(ha/(w*h)*100).toFixed(1)}%)`);
    console.log(`    picked:  ${JSON.stringify(picked.map(p=>[+p.x.toFixed(1),+p.y.toFixed(1)]))}`);
    console.log(`    refined: ${JSON.stringify(refined.map(p=>[+p.x.toFixed(1),+p.y.toFixed(1)]))}`);
  }
  const res = detectPages(rgba, w, h);
  console.log(`  mode=${res.mode} pages=${JSON.stringify(res.pages.map(q=>q.map(p=>[+p.x.toFixed(3),+p.y.toFixed(3)])))}`);
  return res;
}

// Case 1: single top page
const w1 = 360, h1 = 280;
const pageTop: Pt[] = [{x:60,y:20},{x:300,y:25},{x:292,y:120},{x:74,y:115}];
inspect("single top page", w1, h1, paint(w1,h1,(x,y)=> pointIn({x,y},pageTop) ? 240 : null));

// Case 2: two sheets vertically (top box and bottom box)
const w2 = 360, h2 = 480;
const topSheet: Pt[] = [{x:40,y:30},{x:320,y:30},{x:320,y:210},{x:40,y:210}];
const bottomSheet: Pt[] = [{x:40,y:270},{x:320,y:270},{x:320,y:450},{x:40,y:450}];
inspect("two sheets (top & bottom)", w2, h2, paint(w2,h2,(x,y)=> (pointIn({x,y},topSheet)||pointIn({x,y},bottomSheet)) ? 245 : null));

// Case 3: spanning booklet across center
const w3 = 360, h3 = 480;
const booklet: Pt[] = [{x:40,y:30},{x:320,y:30},{x:320,y:450},{x:40,y:450}];
inspect("spanning booklet", w3, h3, paint(w3,h3,(x,y)=> pointIn({x,y},booklet) ? 240 : null));

