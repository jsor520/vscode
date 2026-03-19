/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';

export interface IAgentFileReviewRequest {
	readonly id: string;
	readonly toolName: 'write_file' | 'edit_file';
	readonly resource: URI;
	readonly originalContent: string;
	readonly modifiedContent: string;
	readonly label: string;
	readonly summary: string;
	readonly isNewFile: boolean;
}

export interface IAgentFileReviewResult {
	readonly content: string;
	readonly isError?: boolean;
}

export interface IAgentFileReviewHandler {
	reviewFileChange(request: IAgentFileReviewRequest, token: CancellationToken): Promise<IAgentFileReviewResult>;
}
