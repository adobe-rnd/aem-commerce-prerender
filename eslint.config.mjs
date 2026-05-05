import globals from "globals";
import pluginJs from "@eslint/js";
import pluginJest from 'eslint-plugin-jest';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        files: ["**/*.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: {
                ...globals.node,
            }
        }
    },
    {
        files: ['**/*.spec.js', '**/*.test.js', 'test/mock-server.js'],
        plugins: { jest: pluginJest },
        languageOptions: {
            globals: {
                ...pluginJest.environments.globals.globals,
                ...globals.node,
            },
        },
        rules: {
            'jest/no-disabled-tests': 'warn',
            'jest/no-focused-tests': 'error',
            'jest/no-identical-title': 'error',
            'jest/prefer-to-have-length': 'warn',
            'jest/valid-expect': 'error',
        },
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ['**/*.test.mjs', 'test/mock-server.mjs'],
        plugins: { jest: pluginJest },
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...pluginJest.environments.globals.globals,
                ...globals.node,
            },
        },
        rules: {
            'jest/no-disabled-tests': 'warn',
            'jest/no-focused-tests': 'error',
            'jest/no-identical-title': 'error',
            'jest/prefer-to-have-length': 'warn',
            'jest/valid-expect': 'error',
        },
    },
    pluginJs.configs.recommended,
];
