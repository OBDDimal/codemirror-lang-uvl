import {parser} from "./syntax.grammar"
import {
  LRLanguage,
  LanguageSupport,
  indentNodeProp,
  foldNodeProp,
  foldInside,
  delimitedIndent,
  HighlightStyle, syntaxHighlighting, syntaxTree
} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"
import {Diagnostic, linter} from "@codemirror/lint";
import {autocompletion, CompletionContext} from "@codemirror/autocomplete";

//autocompletion for keywords with a line break
function standardAutocomplete(context: CompletionContext) {
  const keywords = ["mandatory", "optional", "alternative", "or", "constraints"];
  let word = context.matchBefore(/\w*/);
  if (!word) {
    return null;
  }

  if (word.from === word.to && !context.explicit)
    return null;


  const wordFrom = word.from;

  if (wordFrom === word.to && !context.explicit) {
    return null;
  }

  let options = keywords.map(keyword => ({
    label: keyword,
    type: "keyword",
    apply: keyword + '\n' + ' '.repeat(wordFrom - context.state.doc.lineAt(wordFrom).from + 4)
  }));

  return {
    from: word.from,
    options,
    validFor: /^\w*$/
  };
}
function constraintAutocomplete(context: CompletionContext) {
  let word = context.matchBefore(/\w*/);

  if (!word) {
    return null;
  }
  if (word.from === word.to && !context.explicit) return null;

  let features: string[] = [];
  syntaxTree(context.state).cursor().iterate(node => {
    if (node.name === "Feature") {
      let featureText = context.state.doc.sliceString(node.from, node.to);
      features.push(featureText);
    }
  });
  let uniqueFeatures = [...new Set(features)];
  if (uniqueFeatures.length > 0) {
    return {
      from: word.from,
      options: uniqueFeatures.map(f => ({ label: f, type: "keyword" })),
      validFor: /^[\w]*$/
    };
  }
  let nodeBefore = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (nodeBefore.name === "ConstraintItem") {
    return {
      from: context.pos,
      options: [
        { label: "sum()", type: "function" },
        { label: "len()", type: "function" },
        { label: "avg()", type: "function" }
      ],
      validFor: /^[|=>&sumlenavg()]*$/ // valid for
    };
  }
  return null;
}

const customHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#008080", fontWeight: "bold" },
  { tag: t.typeName, color: "#0022ff"},
  { tag: t.tagName, color: "#0022ff", fontWeight: "bold"},
  { tag: t.operator, color: "#404080"},
  { tag: t.bracket, color: "#ae2eae", fontWeight: "bold"},
  { tag: t.className, color: "#830505", fontWeight: "bold"}
]);

export const UVLLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Application: delimitedIndent({closing: "}", align: false})
      }),
      foldNodeProp.add({
        Application: foldInside
      }),
      styleTags({
        //keyword colour
        AbstractItem: t.keyword,
        Feature: t.keyword,
        ConstraintsItem: t.keyword,
        ExtendedFeature: t.keyword,
        Value: t.keyword,
        Number: t.keyword,
        FeatureModel: t.keyword,
        ImportName: t.keyword,
        //tagName colour
        State: t.tagName,
        Neg: t.keyword,
        AttributeItem: t.tagName,
        Operator: t.tagName,
        ConstraintSign: t.tagName,
        Cardinality: t.tagName,
        Key: t.tagName,
        Max: t.tagName,
        Min: t.tagName,
        Specifier: t.tagName,
        AbstractFeature: t.tagName,
        //labelName colour not defined
        Brackets: t.bracket,
        Operation: t.bracket,
        Type: t.bracket,
        //typeName colour
        ConstraintItem: t.typeName,
        //className
        ConstraintsSection: t.className,
        Root: t.className,
        //other
        LineComment: t.lineComment,
      })
    ]
  }),
  languageData: {
    commentTokens: {line: ";"}
  }
})

// Linter-Integration
export const customLinter = linter(view => {
  let diagnostics: Diagnostic[] = []
  const list = [
    "indent",
    "dedent",
    "FeaturesSection",
    "ConstraintsSection",
    "blankLineStart",
    "Comment",
    "Tree",
    "IncludeBlock",
    "ImportBlock",
    "Feature",
    "ImportFeature",
    "ImportName",
    "Specifier",
    "Root",
    "FeatureBlock",
    "ExtendedFeature",
    "Type",
    "Cardinality",
    "Min",
    "Max",
    "AttributeItem",
    "AttributeSelection",
    "Key",
    "Value",
    "StateFeature",
    "StateBlock",
    "State",
    "Counter",
    "ConstraintsBlock",
    "Constraints",
    "Operation",
    "Signs",
    "Number",
    "OpenBracket",
    "NumericOperator",
    "CloseBracket",
    "ConstraintSign",
    "ConstraintsItem",
    "BooleanNeg",
    "BracketItem",
    "SymbolicOperator",
    "Brackets"
  ]

  //constraints preparation. Collecting keys and mapping to features
  let featureKeysMap = new Map();

  syntaxTree(view.state).cursor().iterate(node => {
    if (node.name === "ExtendedFeature") {
      let featureNode = node.node.getChild("Feature");
      let attributeItemNode = node.node.getChild("AttributeItem");

      if (featureNode) {
        let featureText = view.state.doc.sliceString(featureNode.from, featureNode.to).trim();

        // Check if the feature is already in the map
        if (featureKeysMap.has(featureText)) {
          diagnostics.push({
            from: featureNode.from,
            to: featureNode.to,
            severity: "error",
            message: `The feature "${featureText}" is defined more than once.`
          });
        } else {
          if (attributeItemNode) {
            let keys: {key: string, valueType: string}[] = [];
            let keySet = new Set(); // To check for duplicate keys

            attributeItemNode.getChildren("AttributeSelection").forEach(selectionNode => {
              selectionNode.getChildren("Key").forEach(keyNode => {
                let keyText = view.state.doc.sliceString(keyNode.from, keyNode.to).trim();
                let valueNode = selectionNode.getChild("Value"); // Assuming a "Value" node exists
                let valueText = valueNode ? view.state.doc.sliceString(valueNode.from, valueNode.to).trim() : null;

                // Determine if the value is a number (integer/float) or a string
                let valueType: string = "Unknown"; // default
                if (valueText !== null) {
                  if (!Number.isNaN(parseFloat(valueText))) {
                    valueType = Number.isInteger(parseFloat(valueText)) ? 'Integer' : 'Float';
                  } else {
                    valueType = "String";
                  }
                }

                // Check if the key already exists in the keySet
                if (keySet.has(keyText)) {
                  diagnostics.push({
                    from: keyNode.from,
                    to: keyNode.to,
                    severity: "error",
                    message: `The key "${keyText}" is duplicated in the feature "${featureText}".`
                  });
                } else {
                  keySet.add(keyText); // Add key to the set
                  keys.push({key: keyText, valueType: valueType});  // Also add key to the keys list
                }
              });
            });

            featureKeysMap.set(featureText, keys);
          } else {
            featureKeysMap.set(featureText, "");
          }
        }
      }
    }
  });
  syntaxTree(view.state).cursor().iterate(node => {
    if (node.name === "ConstraintsSection") {
      let blockText = view.state.doc.sliceString(node.from, node.to).trim();
      let firstWord = blockText.split(/\s+/)[0];
      if (firstWord !== "constraints") {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: 'The ConstraintsBlock must start with "constraints".'
        });
      }
    } else if (node.name === "FeaturesSection") {
      let blockText = view.state.doc.sliceString(node.from, node.to).trim();
      let firstWord = blockText.split(/\s+/)[0];
      if (firstWord !== "features") {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: 'The FeaturesSection must start with "features".'
        });
      }
    }
  });
  syntaxTree(view.state).cursor().iterate(node => {
    //cardinality [Min..Max]
    if (node.name === "Cardinality" || node.name === "Counter") {
      const text = view.state.doc.sliceString(node.from, node.to);
      const match = text.match(/\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]/);

      if (match) {
        let min = parseInt(match[1], 10);
        let max = parseInt(match[2], 10);

        if (min > max) {
          // Max Min error
          diagnostics.push({
            from: node.from,
            to: node.to,
            severity: "error",
            message: `Invalid syntax: Min (${min}) must be less than Max (${max})`,
          });
        }
      } else {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: `The pattern is number1 .. number2.`,
        });
      }
    } else if (node.name === "ExtendedFeature") {
      let featureNode = node.node.getChild("Feature");
      let attributeNode = node.node.getChild("AttributeItem");
      if (featureNode) {
        let featureText = view.state.doc.sliceString(featureNode.from, featureNode.to);
        let keywords = ["features", "constraints"];
        //"constraints" is still buggy
        if (keywords.includes(featureText)) {
          diagnostics.push({
            from: featureNode.from,
            to: featureNode.to,
            severity: "error",
            message: `The text "${featureText}" is not allowed in the Feature node`,
            actions: [{
              name: "Remove 'features'",
              apply(view, from, to) { view.dispatch({changes: {from, to, insert: ''}}); }
            }]
          });
        }
      }
      if (attributeNode) {
        attributeNode.getChildren("AttributeSelection").forEach(selectionNode => {
          let valueNode = selectionNode.getChild("Value");
          if (valueNode) {
            let valueText = view.state.doc.sliceString(valueNode.from, valueNode.to);
            if (!/^-?\d+$/.test(valueText) && !/^["].*["]$/.test(valueText) && !/^'[a-zA-Z_]\w*'$/.test(valueText)) {
              diagnostics.push({
                from: valueNode.from,
                to: valueNode.to,
                severity: "error",
                message: "Value must be a number, a string in double quotes, or an identifier in single quotes."
              });
            }
          }
        });
      }
    }
    //brackets not matching
    else if (node.name === "Constraints") {
      let constraintText = view.state.doc.sliceString(node.from, node.to);

      let openBrackets = (constraintText.match(/\(/g) || []).length;
      let closeBrackets = (constraintText.match(/\)/g) || []).length;

      if (openBrackets > 1 || closeBrackets > 1) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: "A constraint can only have one pair of parentheses."
        });
      }
      node.node.getChildren("Operation").forEach(operationNode => {
        let keyNode = operationNode.getChild("Key");
        if (keyNode) {
          let keyText = view.state.doc.sliceString(keyNode.from, keyNode.to).trim();

          let allKeys: string[] = [];
          let keyTypeMap = new Map(); // To store the key and its type

          featureKeysMap.forEach(value => {
            if (Array.isArray(value)) {
              // If it's an array, iterate through it
              value.forEach(keyObj => {
                allKeys.push(keyObj.key); // Collect all keys
                keyTypeMap.set(keyObj.key, keyObj.valueType); // Map the key to its value type
              });
            } else {
              // If it's a single object (not an array)
              allKeys.push(value.key); // Collect the key
              keyTypeMap.set(value.key, value.valueType); // Map the key to its value type
            }
          });
          if (!allKeys.includes(keyText)) {
            diagnostics.push({
              from: keyNode.from,
              to: keyNode.to,
              severity: "error",
              message: `"${keyText}" is not a valid key.`
            });
          } else {
            // Check the operation name
            let operationText = view.state.doc.sliceString(operationNode.from, operationNode.to).trim();

            // Extract the function name (e.g. avg, sum, len)
            let functionName = operationText.split('(')[0].trim();

            let valueType;
            for (let [feature, keys] of featureKeysMap.entries()) {
              if (Array.isArray(keys)) {
                keys.forEach(keyObj => {
                  if (keyObj.key === keyText) {
                    valueType = keyObj.valueType;
                  }
                });
              }
            }

            if (functionName === 'avg' || functionName === 'sum') {
              if (valueType !== 'Integer' && valueType !== 'Float') {
                diagnostics.push({
                  from: keyNode.from,
                  to: keyNode.to,
                  severity: "error",
                  message: `"${keyText}" must be a number for the ${functionName} operation.`
                });
              }
            } else if (functionName === 'len') {
              if (valueType !== 'String') {
                diagnostics.push({
                  from: keyNode.from,
                  to: keyNode.to,
                  severity: "error",
                  message: `"${keyText}" must be a string for the len operation.`
                });
              }
            }

          }
        }
      });
      node.node.getChildren("ConstraintsItem").forEach(constraintItemNode => {
        let constraintItemText = view.state.doc.sliceString(constraintItemNode.from, constraintItemNode.to).trim();

        // Remove '!' from Feature
        let isNegated = constraintItemText.startsWith("!");
        if (isNegated) {
          constraintItemText = constraintItemText.slice(1).trim();
        }
        let isId = /^'-?\d+'$/.test(constraintItemText);

        let [feature, key] = constraintItemText.split(".");

// Check if it's a valid feature
        if (featureKeysMap.has(feature)) {
          // Get the list of keys and their types for the feature
          let featureEntries = featureKeysMap.get(feature);

          // If a key is provided, check if it's a valid key for this feature
          if (key) {
            // Extract all keys from the featureEntries
            let validKeys = Array.isArray(featureEntries)
                ? featureEntries.map(entry => entry.key) // Extract the keys from the array
                : [featureEntries.key]; // Single entry case

            if (!validKeys.includes(key)) {
              diagnostics.push({
                from: constraintItemNode.from,
                to: constraintItemNode.to,
                severity: "error",
                message: `"${key}" is not a valid key for the feature "${feature}".`
              });
            }
          }
        }
        else if (!isId && !featureKeysMap.has(constraintItemText)) {
          diagnostics.push({
            from: constraintItemNode.from,
            to: constraintItemNode.to,
            severity: "error",
            message: `"${constraintItemText}" is neither a valid ID nor a declared feature.`
          });
          let words = constraintItemText.trim().split(/\s+/);
          words.forEach(word => {
            if (featureKeysMap.has(word)) {
              diagnostics.push({
                from: constraintItemNode.from,
                to: constraintItemNode.to,
                severity: "error",
                message: `"${word}" has to be seperated by an operator.`
              });
            }
          });
        }
      });
    }
    //blacklist and unrecognized
    if (!list.includes(node.name)) {
      diagnostics.push({
        from: node.from,
        to: node.to,
        severity: "error",
        message: "Features have to be connected with \" or ' ",
      });
    }
  });

  return diagnostics;
});

export function UVL() {
  return new LanguageSupport(UVLLanguage, [
    syntaxHighlighting(customHighlightStyle),
    autocompletion({
      override: [standardAutocomplete, constraintAutocomplete]
    }),
    customLinter
  ]);
}
