/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IMdcRule {
	description: string;
	globs: string[];
	alwaysApply: boolean;
	priority: number;
	body: string;
	source: string;
}
