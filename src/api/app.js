const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");

const apiKeyAuth =
  require("./middleware/apiKeyAuth");

const swaggerSpec =
  require("./swagger/swagger");

function createApp({
  threadController,
  createThreadRoutes
}) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(
    "/swagger",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec)
  );

  app.use(
    "/api/threads",
    apiKeyAuth,
    createThreadRoutes(threadController)
  );

  return app;
}

module.exports = createApp;