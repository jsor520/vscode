/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';

const MAX_CHECKPOINTS = 30;
const CHECKPOINT_DIRECTORY = '.ai-ide/checkpoints';

export class XuanjiCheckpointService {

	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceService: IWorkspaceContextService,
	) { }

	async saveCheckpoint(fileUri: URI, content: string): Promise<URI | undefined> {
		const folders = this._workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}

		const rootUri = folders[0].uri;
		const checkpointDirectory = URI.joinPath(rootUri, CHECKPOINT_DIRECTORY);

		try {
			await this._fileService.createFolder(checkpointDirectory);
		} catch {
			// Ignore create folder failures when the directory already exists.
		}

		const fileName = fileUri.path.split('/').pop() || 'untitled';
		const checkpointName = `${Date.now()}_${fileName}.bak`;
		const checkpointUri = URI.joinPath(checkpointDirectory, checkpointName);

		await this._fileService.writeFile(checkpointUri, VSBuffer.fromString(content));
		await this._cleanupOldCheckpoints(checkpointDirectory);
		return checkpointUri;
	}

	async restoreCheckpoint(fileUri: URI, checkpointUri: URI): Promise<void> {
		const checkpoint = await this._fileService.readFile(checkpointUri);
		await this._fileService.writeFile(fileUri, checkpoint.value);
	}

	private async _cleanupOldCheckpoints(directory: URI): Promise<void> {
		try {
			const stat = await this._fileService.resolve(directory);
			const backupFiles = (stat.children || [])
				.filter(child => !child.isDirectory && child.name.endsWith('.bak'))
				.sort((left, right) => left.name.localeCompare(right.name));

			while (backupFiles.length > MAX_CHECKPOINTS) {
				const oldest = backupFiles.shift();
				if (oldest) {
					await this._fileService.del(oldest.resource);
				}
			}
		} catch {
			// Checkpoint cleanup should never block the main flow.
		}
	}
}
