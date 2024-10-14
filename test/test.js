import { UVLLanguage } from '../dist/index.js';
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Function to recursively find all files in a directory and its subdirectories
function getAllTestFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);

  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      // Recursively call for directories
      results = results.concat(getAllTestFiles(filePath));
    } else if (path.extname(file) === '.uvl') { // Only files with .uvl extension
      results.push(filePath);
    }
  });

  return results;
}

describe('Parser Tests', () => {
  const testDir = path.join(__dirname, 'res_uvl'); // Adjust path to your test folder
  const faultyDir = path.join(testDir, 'faulty'); // Specify the "faulty" folder
  const testFiles = getAllTestFiles(testDir);

  testFiles.forEach(file => {
    const isFaulty = file.startsWith(faultyDir);

    it(`should parse the file ${file} ${isFaulty ? 'and fail' : 'without errors'}`, () => {
      const inputContent = fs.readFileSync(file, 'utf8');

      let parseTree;
      try {
        parseTree = UVLLanguage.parser.parse(inputContent); // Use UVLLanguage.parser to parse the file

        if (isFaulty) {
          assert.fail(`Expected parsing to fail for faulty test ${file}, but it succeeded.`);
        }

        // Check if the parse tree is not null or undefined
        assert(parseTree, `Parse tree should be generated for file ${file} without errors`);
        assert(parseTree.topNode, `Parse tree should have a topNode for file ${file}`);
      } catch (error) {
        if (!isFaulty) {
          assert.fail(`Parsing failed for ${file} with error: ${error.message}`);
        }
        // For faulty tests, we expect a failure, so do nothing
      }
    });
  });
});
