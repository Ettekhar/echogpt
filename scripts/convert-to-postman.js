const Converter = require('openapi-to-postmanv2');
const fs = require('fs');
const path = require('path');

const openApiPath = path.join(__dirname, '..', 'openapi.json');
const outPath = path.join(__dirname, '..', 'postman_collection.json');

const openapiData = fs.readFileSync(openApiPath, 'utf8');

Converter.convert(
  { type: 'string', data: openapiData },
  { folderStrategy: 'Tags', requestParametersResolution: 'Example' },
  (err, result) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    if (!result.result) {
      console.error(result.reason);
      process.exit(1);
    }
    const collection = result.output[0].data;

    // Add a collection-level bearer token variable + auth so requests are ready to run
    // once the user pastes in an access token from /auth/login.
    collection.auth = {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    };
    collection.variable = [
      { key: 'baseUrl', value: 'http://localhost:3000/api/v1', type: 'string' },
      { key: 'accessToken', value: '', type: 'string' },
    ];

    fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));
    console.log(`Postman collection written to ${outPath}`);
  },
);
