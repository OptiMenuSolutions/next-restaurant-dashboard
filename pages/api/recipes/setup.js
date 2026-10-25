import { recipeSetupHandler } from '../../../lib/recipes/handler';

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

export default function handler(req, res) {
  return recipeSetupHandler(req, res);
}