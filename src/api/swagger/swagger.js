const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "WhatsApp Support API",
      version: "1.0.0"
    },

    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key"
        }
      }
    }
  },

  apis: [
    "./routes/*.js"
  ]
};

module.exports = swaggerJsdoc(options);