require("dotenv").config();

const createPostgresPool =
  require("../implementation/database/createPostgresPool");

const ThreadService =
  require("./services/threadService");

const ThreadController =
  require("./controllers/threadController");

const createThreadRoutes =
  require("./routes/threadRoutes");

const createApp =
  require("./app");

const pool =
  createPostgresPool();

const threadService =
  new ThreadService(pool);

const threadController =
  new ThreadController(threadService);

const app = createApp({
  threadController,
  createThreadRoutes
});

const PORT =
  process.env.API_PORT || 3001;

app.listen(PORT, () => {
  console.log(
    `API running on http://localhost:${PORT}`
  );

  console.log(
    `Swagger: http://localhost:${PORT}/swagger`
  );
});