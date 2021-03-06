/*
 * Copyright (c) 2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 */

import getPropertyValuePath from './getPropertyValuePath';
import isReactComponentClass from './isReactComponentClass';
import isReactCreateClassCall from './isReactCreateClassCall';
import isReactCreateElementCall from './isReactCreateElementCall';
import isReactCloneElementCall from './isReactCloneElementCall';
import isReactChildrenElementCall from './isReactChildrenElementCall';
import recast from 'recast';
import resolveToValue from './resolveToValue';

var {types: {namedTypes: types}} = recast;

const validPossibleStatelessComponentTypes = [
  'Property',
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
];

function isJSXElementOrReactCall(path) {
  return (
    path.node.type === 'JSXElement' ||
    (path.node.type === 'CallExpression' && isReactCreateElementCall(path)) ||
    (path.node.type === 'CallExpression' && isReactCloneElementCall(path)) ||
    (path.node.type === 'CallExpression' && isReactChildrenElementCall(path))
  );
}

function resolvesToJSXElementOrReactCall(path) {
  // Is the path is already a JSX element or a call to one of the React.* functions
  if (isJSXElementOrReactCall(path)) {
    return true;
  }

  const resolvedPath = resolveToValue(path);

  // If the path points to a conditional expression, then we need to look only at
  // the two possible paths
  if (resolvedPath.node.type === 'ConditionalExpression') {
    return resolvesToJSXElementOrReactCall(resolvedPath.get('consequent')) ||
      resolvesToJSXElementOrReactCall(resolvedPath.get('alternate'));
  }

  // If the path points to a logical expression (AND, OR, ...), then we need to look only at
  // the two possible paths
  if (resolvedPath.node.type === 'LogicalExpression') {
    return resolvesToJSXElementOrReactCall(resolvedPath.get('left')) ||
      resolvesToJSXElementOrReactCall(resolvedPath.get('right'));
  }

  // Is the resolved path is already a JSX element or a call to one of the React.* functions
  // Only do this if the resolvedPath actually resolved something as otherwise we did this check already
  if (resolvedPath !== path && isJSXElementOrReactCall(resolvedPath)) {
    return true;
  }

  // If we have a call expression, lets try to follow it
  if (resolvedPath.node.type === 'CallExpression') {

    let calleeValue = resolveToValue(resolvedPath.get('callee'));

    if (returnsJSXElementOrReactCall(calleeValue)) {
      return true;
    }

    let resolvedValue;

    let namesToResolve = [calleeValue.get('property')];

    if (calleeValue.node.type === 'MemberExpression') {
      if (calleeValue.get('object').node.type === 'Identifier') {
        resolvedValue = resolveToValue(calleeValue.get('object'));
      } else if (types.MemberExpression.check(calleeValue.node)) {
        do {
          calleeValue = calleeValue.get('object');
          namesToResolve.unshift(calleeValue.get('property'));
        } while (types.MemberExpression.check(calleeValue.node));

        resolvedValue = resolveToValue(calleeValue.get('object'));
      }
    }

    if (resolvedValue && types.ObjectExpression.check(resolvedValue.node)) {
      var resolvedMemberExpression = namesToResolve
        .reduce((result, path) => { // eslint-disable-line no-shadow
          if (!path) {
            return result;
          }

          if (result) {
            result = getPropertyValuePath(result, path.node.name);
            if (result && types.Identifier.check(result.node)) {
              return resolveToValue(result);
            }
          }
          return result;
        }, resolvedValue);

      if (
        !resolvedMemberExpression ||
        returnsJSXElementOrReactCall(resolvedMemberExpression)
      ) {
        return true;
      }
    }
  }

  return false;
}

function returnsJSXElementOrReactCall(path) {
  let visited = false;

  // early exit for ArrowFunctionExpressions
  if (
    path.node.type === 'ArrowFunctionExpression' &&
    path.get('body').node.type !== 'BlockStatement' &&
    resolvesToJSXElementOrReactCall(path.get('body'))
  ) {
    return true;
  }

  let scope = path.scope;
  // If we get a property we want the function scope it holds and not its outer scope
  if (path.node.type === 'Property') {
    scope = path.get('value').scope;
  }

  recast.visit(path, {
    visitReturnStatement(returnPath) {
      // Only check return statements which are part of the checked function scope
      if (returnPath.scope !== scope) return false;

      if (resolvesToJSXElementOrReactCall(returnPath.get('argument'))) {
        visited = true;
        return false;
      }

      this.traverse(returnPath);
    },
  });

  return visited;
}

/**
 * Returns `true` if the path represents a function which returns a JSXElement
 */
export default function isStatelessComponent(
  path: NodePath
): bool {
  var node = path.node;

  if (validPossibleStatelessComponentTypes.indexOf(node.type) === -1) {
    return false;
  }

  if (node.type === 'Property') {
    if (isReactCreateClassCall(path.parent) || isReactComponentClass(path.parent)) {
      return false;
    }
  }

  if (returnsJSXElementOrReactCall(path)) {
    return true;
  }

  return false;
}
