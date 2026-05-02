const fs = require('fs'); const csv = require('csv-parser'); const results = []; fs.createReadStream('test.csv').pipe(csv()).on('data', (d) => results.push(d)).on('end', () => console.log(results));
