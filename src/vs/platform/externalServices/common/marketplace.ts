/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHeaders } from '../../../base/parts/request/common/request.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { getServiceMachineId } from './serviceMachineId.js';
import { IFileService } from '../../files/common/files.js';
import { IProductService } from '../../product/common/productService.js';
import { IStorageService } from '../../storage/common/storage.js';
import { ITelemetryService, TelemetryLevel } from '../../telemetry/common/telemetry.js';
import { getTelemetryLevel, supportsTelemetry } from '../../telemetry/common/telemetryUtils.js';

export async function resolveMarketplaceHeaders(version: string,
	productService: IProductService,
	environmentService: IEnvironmentService,
	configurationService: IConfigurationService,
	fileService: IFileService,
	storageService: IStorageService | undefined,
	telemetryService: ITelemetryService): Promise<IHeaders> {

	const isOpenVsx = productService.extensionsGallery?.serviceUrl?.includes('open-vsx.org');
	const asciiName = productService.applicationName || productService.nameShort.replace(/[^\x20-\x7E]/g, '');
	const headers: IHeaders = isOpenVsx
		? { 'User-Agent': `VSCode ${version} (${asciiName})` }
		: {
			'X-Market-Client-Id': `VSCode ${version}`,
			'User-Agent': `VSCode ${version} (${productService.nameShort})`
		};

	if (!isOpenVsx && supportsTelemetry(productService, environmentService) && getTelemetryLevel(configurationService) === TelemetryLevel.USAGE) {
		const serviceMachineId = await getServiceMachineId(environmentService, fileService, storageService);
		headers['X-Market-User-Id'] = serviceMachineId;
		headers['VSCode-SessionId'] = telemetryService.machineId || serviceMachineId;
	}

	return headers;
}
