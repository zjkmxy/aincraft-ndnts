/**
 * Spawn entity at the intersection point on click, given the properties passed.
 *
 * `<a-entity intersection-spawn="mixin: box; material.color: red">` will spawn
 * `<a-entity mixin="box" material="color: red">` at intersection point.
 */
AFRAME.registerComponent('intersection-spawn', {
  schema: {
    default: '',
    parse: AFRAME.utils.styleParser.parse
  },

  init: function () {
    const data = this.data;
    const el = this.el;

    el.addEventListener(data.event, evt => {
      // Create element.
      const spawnEl = document.createElement('a-entity');

      // Snap intersection point to grid and offset from center.
      const pos = AFRAME.utils.clone(evt.detail.intersection.point)
      data.offset = AFRAME.utils.coordinates.parse(data.offset)
      data.snap = AFRAME.utils.coordinates.parse(data.snap)
      pos.x = Math.floor(pos.x / data.snap.x) * data.snap.x + data.offset.x;
      pos.y = Math.floor(pos.y / data.snap.y) * data.snap.y + data.offset.y;
      pos.z = Math.floor(pos.z / data.snap.z) * data.snap.z + data.offset.z;

      spawnEl.setAttribute('position', pos);
      let boxColor = getRandomColor();
      spawnEl.setAttribute('material', 'color', boxColor);

      // Set components and properties.
      Object.keys(data).forEach(name => {
        if (name === 'event' || name === 'snap' || name === 'offset') {
          return;
        }
        AFRAME.utils.entity.setComponentProperty(spawnEl, name, data[name]);
      });

      // Generate random NDN name
      let ver = Date.now()
      let boxId = `box-${ver}`
      spawnEl.setAttribute('id', boxId);

      // Append to scene.
      el.sceneEl.appendChild(spawnEl);

      // Pass to backend
      let boxJson = {
        '@type': 'a-entity',
        '@id': boxId,
        '@version': ver,
        '@name': `/root/${boxId}`,
        '@children': {},
        'position': `${pos.x} ${pos.y} ${pos.z}`,
        'mixin': 'voxel',
        'material': `color: ${boxColor}`
      }
      let patchJson = {
        'op': 'new',
        'value': boxJson,
        '@name': `/root/${boxId}`,
        '@version': ver,
      }
      ndnts.produce(JSON.stringify(patchJson))
      let patchJsonAdd = {
        'op': 'add',
        'path': `/@children/${boxId}`,
        'value': -1,
        '@name': `/root`,
        '@version': ver,
      }
      ndnts.produce(JSON.stringify(patchJsonAdd))
    });
  }
});

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

function applyPatch(patch) {
  let patchData = JSON.parse(patch);
  if (patchData.op !== 'new') {
    if (patchData.op === 'add' || patchData.op === 'nop') {
      // This is a quick hack: we have already added the box when receiving the `new` patch
      return
    }
    console.error(`Unsupported patch operation: ${patchData.op}`)
    return
  }
  let newObj = patchData.value

  const spawnEl = document.createElement(newObj['@type']);
  spawnEl.setAttribute('id', newObj['@id']);
  spawnEl.setAttribute('position', newObj['position']);
  spawnEl.setAttribute('material', newObj['material']);
  AFRAME.utils.entity.setComponentProperty(spawnEl, 'mixin', newObj['mixin']);
  document.getElementsByTagName('a-scene')[0].appendChild(spawnEl);
};

(async () => {
  await ndnts.connect();
  ndnts.setApplyPatch(patch => applyPatch(patch));
  ndnts.createSync();
})();
