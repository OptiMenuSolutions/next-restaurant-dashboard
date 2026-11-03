
import {
  researchProductOnline,
} from './lib/productWebResearch.js';

const result = await researchProductOnline({
  name: 'Glaze Strawberry',
  brand: null,
  supplier: 'Keystone Foodservice Supply',
  sku: '74135',
  packageSize: '3/#10 CAN',
});

console.log(JSON.stringify(result, null, 2));
