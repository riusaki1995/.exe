/**
 * Genera public/js/mc_manual_registries.js desde minecraft-data (1.21.4).
 * Ejecutar: node scripts/build_mc_registries.js
 *
 * Descarga items.json y entities.json si no existen en la raíz del proyecto.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const BASE = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/1.21.4';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' ' + url));
        return;
      }
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
    }).on('error', reject);
  });
}

async function ensureData() {
  const itemsPath = path.join(root, '_mc_items.json');
  const entPath = path.join(root, '_mc_entities.json');
  if (!fs.existsSync(itemsPath)) {
    console.log('Descargando items.json...');
    await download(BASE + '/items.json', itemsPath);
  }
  if (!fs.existsSync(entPath)) {
    console.log('Descargando entities.json...');
    await download(BASE + '/entities.json', entPath);
  }
}

async function main() {
  await ensureData();
  runBuild();
}

function runBuild() {
const items = JSON.parse(fs.readFileSync(path.join(root, '_mc_items.json'), 'utf8'));
const entities = JSON.parse(fs.readFileSync(path.join(root, '_mc_entities.json'), 'utf8'));

const itemIds = items.map((i) => 'minecraft:' + i.name).filter((id) => id !== 'minecraft:air');
const entityIds = entities.map((e) => 'minecraft:' + e.name);

/** Libro encantado: un encantamiento al máximo (IDs 1.21). */
const BOOK_ENCHANTS = [
  ['minecraft:protection', 4],
  ['minecraft:fire_protection', 4],
  ['minecraft:feather_falling', 4],
  ['minecraft:blast_protection', 4],
  ['minecraft:projectile_protection', 4],
  ['minecraft:respiration', 3],
  ['minecraft:aqua_affinity', 1],
  ['minecraft:thorns', 3],
  ['minecraft:depth_strider', 3],
  ['minecraft:frost_walker', 2],
  ['minecraft:binding_curse', 1],
  ['minecraft:soul_speed', 3],
  ['minecraft:swift_sneak', 3],
  ['minecraft:sharpness', 5],
  ['minecraft:smite', 5],
  ['minecraft:bane_of_arthropods', 5],
  ['minecraft:knockback', 2],
  ['minecraft:fire_aspect', 2],
  ['minecraft:looting', 3],
  ['minecraft:sweeping_edge', 3],
  ['minecraft:efficiency', 5],
  ['minecraft:silk_touch', 1],
  ['minecraft:fortune', 3],
  ['minecraft:power', 5],
  ['minecraft:punch', 2],
  ['minecraft:flame', 1],
  ['minecraft:infinity', 1],
  ['minecraft:multishot', 1],
  ['minecraft:piercing', 4],
  ['minecraft:quick_charge', 3],
  ['minecraft:loyalty', 3],
  ['minecraft:impaling', 5],
  ['minecraft:riptide', 3],
  ['minecraft:channeling', 1],
  ['minecraft:density', 5],
  ['minecraft:breach', 4],
  ['minecraft:wind_burst', 3],
  ['minecraft:luck_of_the_sea', 3],
  ['minecraft:lure', 3],
  ['minecraft:mending', 1],
  ['minecraft:unbreaking', 3],
  ['minecraft:vanishing_curse', 1]
];

function bookEntry(enchantId, level) {
  const short = enchantId.replace('minecraft:', '');
  const label = 'Libro: ' + short.replace(/_/g, ' ') + ' ' + level;
  const id =
    'minecraft:enchanted_book[minecraft:stored_enchantments={levels:{"' +
    enchantId +
    '":' +
    level +
    '}}]';
  return { id, label };
}

/** Variantes con varios encantamientos (componentes 1.21). */
const STACK_PRESETS = [
  {
    label: 'Espada netherite (Fil V, Saqueo III, …)',
    id: 'minecraft:netherite_sword[minecraft:enchantments={levels:{"minecraft:sharpness":5,"minecraft:looting":3,"minecraft:sweeping_edge":3,"minecraft:unbreaking":3,"minecraft:mending":1,"minecraft:fire_aspect":2}}]'
  },
  {
    label: 'Pico netherite (Efic V, Fortuna III)',
    id: 'minecraft:netherite_pickaxe[minecraft:enchantments={levels:{"minecraft:efficiency":5,"minecraft:fortune":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Pico netherite (Toque de seda)',
    id: 'minecraft:netherite_pickaxe[minecraft:enchantments={levels:{"minecraft:efficiency":5,"minecraft:silk_touch":1,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Hacha netherite (Efic V, Fortuna III)',
    id: 'minecraft:netherite_axe[minecraft:enchantments={levels:{"minecraft:efficiency":5,"minecraft:fortune":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Pala netherite (Efic V, Fortuna III)',
    id: 'minecraft:netherite_shovel[minecraft:enchantments={levels:{"minecraft:efficiency":5,"minecraft:fortune":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Azada netherite (Efic V, Fortuna III)',
    id: 'minecraft:netherite_hoe[minecraft:enchantments={levels:{"minecraft:efficiency":5,"minecraft:fortune":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Arco (Poder V, Infinity)',
    id: 'minecraft:bow[minecraft:enchantments={levels:{"minecraft:power":5,"minecraft:unbreaking":3,"minecraft:mending":1,"minecraft:infinity":1}}]'
  },
  {
    label: 'Ballesta (Perforación IV, Carga rápida III)',
    id: 'minecraft:crossbow[minecraft:enchantments={levels:{"minecraft:piercing":4,"minecraft:quick_charge":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Tridente (Lealtad III, Empalamiento V)',
    id: 'minecraft:trident[minecraft:enchantments={levels:{"minecraft:loyalty":3,"minecraft:impaling":5,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Maza (Densidad V, Brecha IV, Ráfaga de viento III)',
    id: 'minecraft:mace[minecraft:enchantments={levels:{"minecraft:density":5,"minecraft:breach":4,"minecraft:wind_burst":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Casco netherite (Protección IV, Respiración III, …)',
    id: 'minecraft:netherite_helmet[minecraft:enchantments={levels:{"minecraft:protection":4,"minecraft:respiration":3,"minecraft:aqua_affinity":1,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Peto netherite (Protección IV)',
    id: 'minecraft:netherite_chestplate[minecraft:enchantments={levels:{"minecraft:protection":4,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Grebas netherite (Protección IV, Agilidad III)',
    id: 'minecraft:netherite_leggings[minecraft:enchantments={levels:{"minecraft:protection":4,"minecraft:swift_sneak":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Botas netherite (Protección IV, Profundidad III, …)',
    id: 'minecraft:netherite_boots[minecraft:enchantments={levels:{"minecraft:protection":4,"minecraft:depth_strider":3,"minecraft:feather_falling":4,"minecraft:soul_speed":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Elytra (Reparación, Irromp III)',
    id: 'minecraft:elytra[minecraft:enchantments={levels:{"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  },
  {
    label: 'Caña (Suerte marina III, Ceb III)',
    id: 'minecraft:fishing_rod[minecraft:enchantments={levels:{"minecraft:luck_of_the_sea":3,"minecraft:lure":3,"minecraft:unbreaking":3,"minecraft:mending":1}}]'
  }
];

const enchantedBookEntries = BOOK_ENCHANTS.map(([eid, lvl]) => bookEntry(eid, lvl));

const allEnchanted = enchantedBookEntries.concat(STACK_PRESETS);

function escArr(arr) {
  return JSON.stringify(arr);
}

const out = `/* Auto-generado por scripts/build_mc_registries.js — datos 1.21.4 (PrismarineJS/minecraft-data). No editar a mano: ejecuta node scripts/build_mc_registries.js */
(function (g) {
  'use strict';
  g.MC_MANUAL_ENTITY_IDS = ${escArr(entityIds)};
  g.MC_MANUAL_ITEM_IDS = ${escArr(itemIds)};
  /** Entradas extra: libros por encantamiento + equipos preset (give con componentes). */
  g.MC_MANUAL_ENCHANTED_ITEM_ENTRIES = ${JSON.stringify(allEnchanted)};
})(typeof window !== 'undefined' ? window : global);
`;

const outPath = path.join(root, 'public', 'js', 'mc_manual_registries.js');
fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath, 'entities', entityIds.length, 'items', itemIds.length, 'enchanted extras', allEnchanted.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
