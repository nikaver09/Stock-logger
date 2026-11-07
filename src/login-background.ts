// SVG adaptation of the supplied Rack figure for the TypeScript login page.
export function initLoginBackground() {
  const stage = document.getElementById('login-rack');
  const svg = stage?.querySelector('svg');
  if (!stage || !svg) return;
  const animationMedia = window.matchMedia(
    '(min-width: 761px) and (prefers-reduced-motion: no-preference)',
  );
  const ns = 'http://www.w3.org/2000/svg';
  const project = (x: number, y: number, z: number) => [
    192 + (x - y) * 1.65,
    330 + (x + y) * 0.7 - z * 2.45,
  ];
  const group = () => {
    const node = document.createElementNS(ns, 'g');
    svg.append(node);
    return node;
  };
  const box = (parent: SVGGElement, className = '') => {
    const node = document.createElementNS(ns, 'g');
    node.setAttribute('class', `rack-solid ${className}`);
    const faces = ['side', 'front', 'top'].map((face) => {
      const polygon = document.createElementNS(ns, 'polygon');
      polygon.setAttribute('class', `rack-${face}`);
      node.append(polygon);
      return polygon;
    });
    parent.append(node);
    return {
      node,
      draw(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        z0: number,
        z1: number,
      ) {
        const points = [
          [
            [x0, y0, z0],
            [x0, y1, z0],
            [x0, y1, z1],
            [x0, y0, z1],
          ],
          [
            [x0, y1, z0],
            [x1, y1, z0],
            [x1, y1, z1],
            [x0, y1, z1],
          ],
          [
            [x0, y0, z1],
            [x1, y0, z1],
            [x1, y1, z1],
            [x0, y1, z1],
          ],
        ];
        faces.forEach((face, i) => {
          face.setAttribute(
            'points',
            points[i].map(([x, y, z]) => project(x, y, z).join(',')).join(' '),
          );
        });
      },
    };
  };
  const frame = group();
  box(frame).draw(0, 0, 70, 64, 0, 5);
  box(frame).draw(0, 0, 70, 4, 5, 96);
  box(frame).draw(0, 0, 4, 64, 5, 96);
  box(frame).draw(66, 0, 70, 4, 5, 96);
  const units = Array.from({ length: 8 }, (_, index) => {
    const parent = group();
    const body = box(parent, 'rack-unit');
    const leds = Array.from({ length: 3 }, () => {
      const led = document.createElementNS(ns, 'circle');
      led.setAttribute('r', '1.8');
      parent.append(led);
      return led;
    });
    return {
      index,
      body,
      leds,
      x: index === 5 ? 9 : 0,
    };
  });
  const foreground = group();
  box(foreground).draw(66, 60, 70, 64, 5, 96);
  box(foreground).draw(0, 0, 70, 64, 96, 99);
  let selected = -1;
  let frameId = 0;
  let previous: number | null = null;
  let elapsed = 0;
  function render() {
    units.forEach((unit) => {
      const z = 7 + unit.index * 10.6;
      const front = 62 + unit.x;
      unit.body.draw(5, 4, 65, front, z, z + 9);
      unit.body.node.classList.toggle('is-selected', unit.index === selected);
      unit.leds.forEach((led, i) => {
        const [x, y] = project(12 + i * 5, front, z + 4.5);
        led.setAttribute('cx', String(x));
        led.setAttribute('cy', String(y));
        led.setAttribute(
          'class',
          unit.x > 4 + i * 6 ? 'rack-led is-on' : 'rack-led',
        );
      });
    });
  }
  function animate(time: number) {
    if (previous !== null) elapsed += Math.min((time - previous) / 1000, 0.05);
    previous = time;
    let mostOpen = 0;
    units.forEach((unit) => {
      // Stagger a smooth ten-second open/close cycle through all eight drawers.
      const phase = (elapsed / 3 - unit.index / 10) * Math.PI * 2;
      unit.x = 30 * Math.pow((1 - Math.cos(phase)) / 2, 4);
      if (unit.x > units[mostOpen].x) mostOpen = unit.index;
    });
    selected = units[mostOpen].x > 12 ? mostOpen : -1;
    render();
    frameId = requestAnimationFrame(animate);
  }
  function syncAnimation() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    previous = null;
    if (animationMedia.matches && !document.hidden) {
      frameId = requestAnimationFrame(animate);
    } else if (!animationMedia.matches) {
      selected = -1;
      units.forEach((unit) => {
        unit.x = unit.index === 5 ? 9 : 0;
      });
      render();
    }
  }
  render();
  syncAnimation();
  animationMedia.addEventListener('change', syncAnimation);
  document.addEventListener('visibilitychange', syncAnimation);
  window.addEventListener('pageshow', syncAnimation);
  const destroy = () => {
    cancelAnimationFrame(frameId);
    animationMedia.removeEventListener('change', syncAnimation);
    document.removeEventListener('visibilitychange', syncAnimation);
    window.removeEventListener('pageshow', syncAnimation);
    window.removeEventListener('pagehide', onPageHide);
    svg.replaceChildren();
  };
  function onPageHide(event: PageTransitionEvent) {
    if (!event.persisted) destroy();
  }
  window.addEventListener('pagehide', onPageHide);
  if (import.meta.hot) import.meta.hot.dispose(destroy);
}
