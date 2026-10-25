import { withAdminAuth } from '../../../lib/admin/withAdminAuth';
import { recipeSetupHandler } from '../../../lib/recipes/handler';

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
};

export default withAdminAuth((req, res, admin) =>
  recipeSetupHandler(req, res, admin)
);