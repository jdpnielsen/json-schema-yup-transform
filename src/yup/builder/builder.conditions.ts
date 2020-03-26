import { JSONSchema7 } from "json-schema";
import get from "lodash/get";
import has from "lodash/has";
import isArray from "lodash/isArray";
import isEmpty from "lodash/isEmpty";
import omit from "lodash/omit";
import { getProperties, isSchemaObject, getConditions } from "../../schema/";
import { getObjectHead } from "../utils";
import { getDefinition } from "./builder.definitions";

/** Take the current condition properties and update with new type property */

const updateConditionProperties = (
  conditionProperties: JSONSchema7["properties"],
  schemaPropertyType: JSONSchema7["type"],
  [key, value]: [string, JSONSchema7]
): JSONSchema7["properties"] => {
  // should condition properties not have type attribute
  // retrieve from schema properties
  if (schemaPropertyType) {
    return {
      ...conditionProperties,
      [key]: {
        ...value,
        type: schemaPropertyType
      }
    };
  }
  // if no type attribute found in schema properties and
  // condition properties throw error
  throw new Error("Type attribute is missing");
};

/**
 * Get array items schema from definitions and add to condition schema
 */

const mergeArrayItemsDefinition = (
  [key, value]: [string, JSONSchema7],
  jsonSchema: JSONSchema7,
  newConditionProperties: JSONSchema7["properties"]
): JSONSchema7["properties"] => {
  const { items } = value;
  const definition = isSchemaObject(items) && getDefinition(items, jsonSchema);
  if (!isSchemaObject(definition)) {
    return newConditionProperties;
  }
  return {
    ...newConditionProperties,
    [key]: {
      ...value,
      items: {
        ...definition
      }
    }
  };
};

/**
 * Get schema from definitions and add to condition schema
 */

const mergePropertiesDefinition = (
  [key, value]: [string, JSONSchema7],
  jsonSchema: JSONSchema7,
  newConditionProperties: JSONSchema7["properties"]
): JSONSchema7["properties"] => {
  const definition = getDefinition(value, jsonSchema);
  if (!isSchemaObject(definition)) {
    return newConditionProperties;
  }
  return {
    ...newConditionProperties,
    [key]: {
      ...definition
    }
  };
};

/**
 * Get first key value pair from condition schema
 */

const getThenElsePropertyItem = (
  conditionProperties: JSONSchema7["properties"]
): false | [string, JSONSchema7] => {
  const conditionPropertyItem =
    isSchemaObject(conditionProperties) && getObjectHead(conditionProperties);
  if (!conditionPropertyItem) {
    return false;
  }
  const [key, value] = conditionPropertyItem;
  if (!isSchemaObject(value)) {
    return false;
  }
  return [key, value];
};

/**
 * Adds properties from then and else properties to the schema properties object
 * should they not exist. Only the type attribute is added to determine the yup schema.
 * If from then and else properties are missing add type attribute to them
 * from the schema properties
 */

const updateThenElseProperties = (
  jsonSchema: JSONSchema7,
  conditionSchema: JSONSchema7
):
  | false
  | {
      properties: JSONSchema7["properties"];
      conditions: JSONSchema7;
    } => {
  const schemaProperties = getProperties(jsonSchema);
  const conditionProperties = getProperties(conditionSchema);
  if (!schemaProperties || !conditionProperties) {
    return false;
  }

  let newProperties: JSONSchema7["properties"] = {};
  let newConditionProperties: JSONSchema7["properties"] = {};

  /** Get the first condition property */
  const conditionItem = getThenElsePropertyItem(conditionProperties);
  if (!isArray(conditionItem)) {
    return false;
  }
  const [key, value] = conditionItem;

  /** Update condition schema if array items schema has $ref */
  newConditionProperties = mergeArrayItemsDefinition(
    conditionItem,
    jsonSchema,
    newConditionProperties
  );

  /** Update condition schema schema if it has $ref */
  newConditionProperties = mergePropertiesDefinition(
    conditionItem,
    jsonSchema,
    newConditionProperties
  );

  // Get schema property item using condition schema key
  const schemaPropertyItem = get(schemaProperties, key);
  const { type } = value;

  // Add type property to condition schema if NOT found
  if (isSchemaObject(schemaPropertyItem) && !type) {
    const schemaPropertyType = get(schemaPropertyItem, "type");
    newConditionProperties = updateConditionProperties(
      newConditionProperties,
      schemaPropertyType,
      conditionItem
    );
  }

  // Add condition schema to property schema if NOT found
  if (!isSchemaObject(schemaPropertyItem)) {
    newProperties = {
      ...newProperties,
      [key]: {
        type
      }
    };
  }

  return {
    properties: { ...schemaProperties, ...newProperties },
    conditions: {
      ...conditionSchema,
      properties: {
        ...conditionProperties,
        ...newConditionProperties
      }
    }
  };
};

/**
 * JSON Schema does not enforce `type` attribute to be available on all schemas
 * This utility requires a type property to determine the matching yup schema.
 * This function updates If schema with type property if it is missing.
 */

const updateIfCondition = (
  jsonSchema: JSONSchema7,
  condition: JSONSchema7
): JSONSchema7 => {
  const schemaProperties = getProperties(jsonSchema);
  const conditionProperties = getProperties(condition);
  let newConditionProperties: JSONSchema7["properties"] = {};
  if (schemaProperties && conditionProperties) {
    const conditionPropertyItem = getObjectHead(conditionProperties);
    if (!isArray(conditionPropertyItem)) {
      throw new Error("If schema property is empty");
    }
    const [key, value] = conditionPropertyItem;
    if (!isSchemaObject(value) || isEmpty(value)) {
      throw new Error("Type property not present in If Schema");
    }
    const props = get(schemaProperties, key);
    if (isSchemaObject(props) && !has(value, "type")) {
      newConditionProperties = {
        ...newConditionProperties,
        [key]: {
          ...value,
          type: get(props, "type")
        }
      };
    }
    if (!isSchemaObject(props) && !has(value, "type")) {
      throw new Error(
        "Unable to find the schema property related to the if schema"
      );
    }
  }
  return {
    ...condition,
    properties: { ...conditionProperties, ...newConditionProperties }
  };
};

/**
 * Update the schema with any If schema modifications
 */

const mergeIfCondition = (
  jsonSchema: JSONSchema7,
  _if: JSONSchema7["if"]
): JSONSchema7 => {
  if (isSchemaObject(_if)) {
    const ifSchema = updateIfCondition(jsonSchema, _if);
    jsonSchema = { ...jsonSchema, if: { ...ifSchema } };
  }
  return jsonSchema;
};

/**
 * Update the schema with any Then schema modifications
 */

const mergeThenCondition = (
  jsonSchema: JSONSchema7,
  _then: JSONSchema7["then"]
): JSONSchema7 => {
  if (isSchemaObject(_then)) {
    const result = updateThenElseProperties(jsonSchema, _then);
    if (!result) {
      return omit(jsonSchema, ["then"]);
    }
    const { properties, conditions } = result;
    jsonSchema = {
      ...jsonSchema,
      properties: { ...properties },
      then: { ...conditions }
    };
  }
  return jsonSchema;
};

/**
 * Update the schema with any Else schema modifications
 */

const mergeElseCondition = (
  jsonSchema: JSONSchema7,
  _else: JSONSchema7["else"]
): JSONSchema7 => {
  if (isSchemaObject(_else)) {
    const result = updateThenElseProperties(jsonSchema, _else);
    if (!result) {
      return omit(jsonSchema, ["else"]);
    }
    const { properties, conditions } = result;
    jsonSchema = {
      ...jsonSchema,
      properties: { ...properties },
      else: { ...conditions }
    };
  }
  return jsonSchema;
};

/**
 * Update schema conditions(if, then, else) and properties with any required
 * or missing information
 */

export const mergeConditions = (jsonSchema: JSONSchema7): JSONSchema7 => {
  /** get then, else properties and determine are they dynamic or exist in properties */
  const [_if, _then, _else] = getConditions(jsonSchema);
  jsonSchema = mergeIfCondition(jsonSchema, _if);
  jsonSchema = mergeThenCondition(jsonSchema, _then);
  jsonSchema = mergeElseCondition(jsonSchema, _else);
  return jsonSchema;
};
