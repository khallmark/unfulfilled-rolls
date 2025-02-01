import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// Setup __filename and __dirname similar to CommonJS.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a require function for our ES module.
const require = createRequire(import.meta.url);

// Define dummy Roll and Die classes that we will inject into our sandbox.
class DummyRoll {
  _evaluate() {}
}
class DummyDie {
  constructor(faces, number = 1, fulfilled = []) {
    this.faces = faces;
    this.number = number;
    this._fulfilled = fulfilled;
  }
  _evaluate() {}
}

// Read the content of the production file.
const modulePath = path.join(__dirname, "../scripts/fulfillable-roll.mjs");
let moduleCode = fs.readFileSync(modulePath, 'utf8');

// Remove ES module import statements.
// This regex safely strips lines that start with "import ...;"
moduleCode = moduleCode.replace(/^import\s.+;$\n?/gm, '');

// Also remove export keywords so that the file can be executed as a plain script.
moduleCode = moduleCode.replace(/^export\s+(default\s+)?/gm, '');

// Create a sandbox context and inject our dummy definitions.
const sandbox = {
  console,
  process,
  require,
  __dirname,
  __filename,
  // Inject our dummy definitions for Foundry's Roll and Die.
  Roll: DummyRoll,
  Die: DummyDie,
  global: {}
};

const context = vm.createContext(sandbox);

// Append code to export the private _identifyFulfillableTerms function to the global object.
const wrappedCode = `${moduleCode}\nglobal._identifyFulfillableTerms = _identifyFulfillableTerms;`;
const script = new vm.Script(wrappedCode, { filename: modulePath });
script.runInContext(context);

// Extract _identifyFulfillableTerms from the sandbox global.
const _identifyFulfillableTerms = context.global._identifyFulfillableTerms;
if (!_identifyFulfillableTerms) {
  console.error("Test error: Could not extract _identifyFulfillableTerms from the production file. Check that the function exists and that the export assignment was appended correctly.");
  process.exit(1);
}

// Use the same DummyDie class from our sandbox to create test terms.
const Die = DummyDie;

// Define a dummy configuration object. The keys are of the form "d<value>" with valid non-'fvtt' methods.
const config = {
  d20: "manual",
  d4: "advanced",
  d15: "custom"
};

// ==================
// TEST CASES BELOW
// ==================

// Term 1: No annotation. Should extract base 20 and map to "manual".
const term1 = new Die("20");

// Term 2: With valid math function (case-insensitive) that changes the base.
// "16[Sqrt()]" should evaluate as sqrt(16) = 4, mapping to key "d4" → method "advanced".
const term2 = new Die("16[Sqrt()]");

// Term 3: With a non-math annotation; the annotation is ignored, so the base stays 20 → "manual".
const term3 = new Die("20[nonMath()]");

// Term 4: Already fulfilled. Should be skipped.
const term4 = new Die("15", 1, [1]);

// Term 5: Chaining valid math functions.
// "16[Sqrt()][Floor()]" → sqrt(16)=4 then floor(4)=4 → d4 => "advanced".
const term5 = new Die("16[Sqrt()][Floor()]");

// --- Additional Comprehensive Test Cases ---

// Term 6: Invalid numeric base. e.g., "abc[Sqrt()]" produces NaN, so it should be skipped.
const term6 = new Die("abc[Sqrt()]");

// Term 7: Invalid math function syntax (missing parentheses).
// "20[Sqrt]" is not matching the expected pattern, so no math function is applied. 
// Base remains 20 → "manual".
const term7 = new Die("20[Sqrt]");

// Term 8: Unsupported math function.
// "20[NotAFunction()]" is ignored because Math.NotAFunction is undefined. Base remains 20 → "manual".
const term8 = new Die("20[NotAFunction()]");

// Term 9: Mixed, valid then valid chaining using lowercase for the second function.
// "20[Sqrt()][floor()]" → Sqrt() makes it sqrt(20) ≈ 4.4721 then floor(4.4721)=4 → "advanced".
const term9 = new Die("20[Sqrt()][floor()]");

// Term 10: Mixed valid and invalid chaining.
// "20[Sqrt()][NotAFunction()][Floor()]" → Sqrt() → ~4.4721, NotAFunction() ignored, Floor() makes it 4 → "advanced".
const term10 = new Die("20[Sqrt()][NotAFunction()][Floor()]");

// Term 11: Valid math function preserving the number.
// "15[Floor()]" should keep 15 unchanged → "custom".
const term11 = new Die("15[Floor()]");

// Assemble all terms in an array.
const terms = [term1, term2, term3, term4, term5, term6, term7, term8, term9, term10, term11];

// Execute the function, which returns an array of fulfillable term descriptors.
const fulfillable = _identifyFulfillableTerms(terms, config);

// ==================
// ASSERTIONS BELOW
// ==================
let testPassed = true;

if (!fulfillable.some(item => item.term === term1 && item.method === "manual")) {
  console.error("Test failed: term1 did not extract base 20 correctly. Expected method 'manual'.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term2 && item.method === "advanced")) {
  console.error("Test failed: term2 ('16[Sqrt()]') did not evaluate to 4 correctly, expected method 'advanced'.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term3 && item.method === "manual")) {
  console.error("Test failed: term3 ('20[nonMath()]') did not ignore the non-math annotation, expected base 20 → method 'manual'.");
  testPassed = false;
}

if (fulfillable.some(item => item.term === term4)) {
  console.error("Test failed: term4 is already fulfilled and should have been skipped.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term5 && item.method === "advanced")) {
  console.error("Test failed: term5 ('16[Sqrt()][Floor()]') did not chain math functions correctly to yield 4, expected method 'advanced'.");
  testPassed = false;
}

if (fulfillable.some(item => item.term === term6)) {
  console.error("Test failed: term6 ('abc[Sqrt()]') has an invalid numeric base and should be skipped.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term7 && item.method === "manual")) {
  console.error("Test failed: term7 ('20[Sqrt]') has invalid function syntax; expected base to remain 20 → method 'manual'.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term8 && item.method === "manual")) {
  console.error("Test failed: term8 ('20[NotAFunction()]') uses an unsupported function so should default to base 20 → method 'manual'.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term9 && item.method === "advanced")) {
  console.error("Test failed: term9 ('20[Sqrt()][floor()]') did not process valid chaining correctly; expected evaluation to 4 → method 'advanced'.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term10 && item.method === "advanced")) {
  console.error("Test failed: term10 ('20[Sqrt()][NotAFunction()][Floor()]') did not correctly process the mixed chaining; expected evaluation to 4 → method 'advanced'.");
  testPassed = false;
}

if (!fulfillable.some(item => item.term === term11 && item.method === "custom")) {
  console.error("Test failed: term11 ('15[Floor()]') did not keep the base 15 correctly, expected method 'custom'.");
  testPassed = false;
}

if (testPassed) {
  console.log("All tests passed.");
  process.exit(0);
} else {
  process.exit(1);
}

// Comprehensive?
// Current tests now check for:
// • Plain numeral extraction (term1)
// • Single valid math function call with case handling (term2)
// • Ignoring non-math bracket expressions (term3)
// • Skipping already fulfilled terms (term4)
// • Chaining valid math functions (term5)
// • Handling invalid numeric bases (term6)
// • Handling invalid function syntax (term7)
// • Handling unsupported math functions (term8)
// • Mixed valid function chaining in alternate case (term9)
// • Mixed chaining with an invalid function in the middle (term10)
// • A valid transformation preserving the number (term11) 