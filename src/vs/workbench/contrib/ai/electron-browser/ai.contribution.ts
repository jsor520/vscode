/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAIService } from '../../../../platform/ai/common/aiService.js';
import { ElectronAIServiceImpl } from '../../../../platform/ai/electron-browser/aiServiceImpl.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ICommandSandboxService } from '../common/commandSandboxService.js';
import { ElectronCommandSandboxService } from './commandSandboxService.js';

registerSingleton(IAIService, ElectronAIServiceImpl, InstantiationType.Delayed);
registerSingleton(ICommandSandboxService, ElectronCommandSandboxService, InstantiationType.Delayed);
