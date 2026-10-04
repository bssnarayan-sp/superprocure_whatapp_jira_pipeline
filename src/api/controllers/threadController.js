class ThreadController {
  constructor(threadService) {
    this.threadService = threadService;
  }

  getThreads = async (req, res) => {
    try {
      const page = Math.max(
        parseInt(req.query.page || "1"),
        1
      );

      const pageSize = Math.min(
        Math.max(
          parseInt(req.query.pageSize || "20"),
          1
        ),
        100
      );

      const result =
        await this.threadService.getThreads(
          page,
          pageSize
        );

      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  };

  getMessages = async (req, res) => {
    try {
      const messages =
        await this.threadService.getMessages(
          req.params.threadId
        );

      res.json(messages);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  };
}

module.exports = ThreadController;