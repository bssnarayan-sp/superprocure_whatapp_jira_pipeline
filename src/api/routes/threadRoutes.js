const express = require("express");

function createThreadRoutes(controller) {
    const router = express.Router();

    /**
   * @swagger
   * /api/threads:
   *   get:
   *     tags:
   *       - Support Threads
   *     summary: Get paginated support threads
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: pageSize
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Thread list
   */
    router.get("/", controller.getThreads);

    /**
 * @swagger
 * /api/threads/{threadId}/messages:
 *   get:
 *     tags:
 *       - Support Threads
 *     summary: Get messages for a support thread
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: threadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Messages belonging to the thread
 */
    router.get(
        "/:threadId/messages",
        controller.getMessages
    );

    return router;
}

module.exports = createThreadRoutes;