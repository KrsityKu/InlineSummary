//  SillyTavern - Inline Summary Extension

// =========================
// Constants
// =========================
const kExtensionName = "InlineSummary";
const kExtensionFolderPath = `scripts/extensions/third-party/${kExtensionName}`;
const kSettingsFile = `${kExtensionFolderPath}/settings.html`;
const kDefaultsFile = `${kExtensionFolderPath}/defaults.json`;
const kExtraDataKey = "ILS_Data";
const kOriginalMessagesKey = "OriginalMessages";
const kMessageEstimatedTokenCountKey = "EstimatedTokens";

const kMsgBtnColours = {
	default: null,
	selected: "#4CAF50",
	between: "#FFEB3B",
	clearable: "#2196F3",
};

const kDepthColours = [
	"#FF9AA2",
	"#FFB347",
	"#FFF275",
	"#B5E550",
	"#8EE5D8",
	"#89CFF0",
	"#A28CFF",
	"#FFB7CE",
	"#C7FF8F",
];

const kDefaultSettings = Object.freeze({
	startPrompt: "Undefined",
	midPrompt: "",
	endPrompt: "",
	historicalContexDepth: -1,
	historicalContextStartMarker: "<Historical_Context>",
	historicalContextEndMarker: "</Historical_Context>",
	summariseStartMarker: "<Content_To_Summarise>",
	summariseEndMarker: "</Content_To_Summarise>",
	tokenLimit: 0,
	useDifferentProfile: false,
	profileName: "<None>",
	useDifferentApiPreset: false,
	apiPresets: {},
	autoScroll: true,
	summaryNameMode: "custom",
	summaryName: "Summary",
});

// =========================
// Includes/API/Globals
// =========================

import { amount_gen as textMaxTokens } from "../../../../script.js";
import { download, getSanitizedFilename } from '../../../../scripts/utils.js';
import { POPUP_RESULT, Popup } from '../../../../scripts/popup.js';

let gSettings = {};
let gSpName = "Default";
const kILSGlobalKey = Symbol.for("InlineSummary.ILS");

function GetILSInstance()
{
	const g = globalThis;

	if (!g[kILSGlobalKey])
		g[kILSGlobalKey] = {};

	return g[kILSGlobalKey];
}

function IsOperationLockEngaged()
{
	const ilsInstance = GetILSInstance()
	if (ilsInstance.operationLock)
		return true;

	return false;
}

// =========================
// Helpers
// =========================
function GetDepthColour(depth)
{
	return kDepthColours[depth % kDepthColours.length];
}

function GetDepthColourWithAlpha(depth, alpha)
{
	const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, "0").toUpperCase();
	return GetDepthColour(depth) + alphaHex;
}

function GetMessageByIndex(msgIndex, stContext)
{
	return stContext.chat[msgIndex];
}

function Sleep(ms)
{
	return new Promise(resolve => setTimeout(resolve, ms));
}

function MakeSpinner()
{
	const spinner = document.createElement("div");
	spinner.className = "ils_loading_spinner";
	spinner.innerHTML = '<i class="fa-solid fa-spinner"></i>';

	return spinner;
}

function ShowError(text, exception)
{
	let errText = "[ILS] " + text;
	if (exception)
		errText += "\nError Info:\n" + exception;
	console.error(errText);
	toastr.error(errText);
}

function ShowWarning(text, exception)
{
	let errText = "[ILS] " + text;
	if (exception)
		errText += "\nWarning Info:\n" + exception;
	console.warn(errText);
	toastr.warning(errText);
}

// =========================
// Selection Helpers
// =========================
function GetSelection(stContext)
{
	if (!stContext.chatMetadata.ils_selection)
		stContext.chatMetadata.ils_selection = { start: null, end: null };
	return stContext.chatMetadata.ils_selection;
}

function ClearSelection(stContext)
{
	stContext.chatMetadata.ils_selection = { start: null, end: null };
	RefreshAllMessageButtons();
}

function IsMsgInRange(msgIndex, selection)
{
	return selection.start !== null
		&& selection.end !== null
		&& msgIndex >= selection.start
		&& msgIndex <= selection.end;
}

function IsValidRangeSelection(selection)
{
	return selection.start !== null
		&& selection.end !== null
		&& (selection.end - selection.start) >= 1;
}

// =========================
// Settings
// =========================
async function LoadSettings(stContext)
{
	// Get or Initialise root settings
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];

	// Get Settings name
	let settingPresetName = rootSettings.spName ?? "Default";
	rootSettings.spName = settingPresetName;

	let activeSettings = rootSettings;

	// Ensure Presets initialized when not using Default.
	if (settingPresetName !== "Default")
	{
		rootSettings.spData ??= {};
		rootSettings.spData[settingPresetName] ??= {};
		activeSettings = rootSettings.spData[settingPresetName];
	}

	const defaultsJson = await $.get(kDefaultsFile);
	for (const settingKey of Object.keys(kDefaultSettings))
	{
		if (Object.hasOwn(activeSettings, settingKey))
			continue;

		switch (settingKey)
		{
			case "startPrompt":
				activeSettings.startPrompt = defaultsJson.defaultPrompt;
				break;

			default:
				activeSettings[settingKey] = kDefaultSettings[settingKey];
				break;
		}
	}

	return [activeSettings, settingPresetName];
}

// =========================
// Chat Message Functions
// =========================
function HasOriginalMessages(msgObject)
{
	return msgObject && msgObject.extra && msgObject.extra[kExtraDataKey] && Array.isArray(msgObject.extra[kExtraDataKey][kOriginalMessagesKey]);
}

async function CreateEmptySummaryMessage(originalMessages, stContext)
{
	const summary = {
		is_user: false,
		is_system: false,
		mes: "Generating...",
		extra: {}
	};

	switch (gSettings.summaryNameMode)
	{
		case "user":
			summary.name = stContext.name1;
			summary.is_user = true;
			break;
		case "character":
			summary.name = stContext.name2;
			break;
		case "custom":
		default:
			summary.name = gSettings.summaryName;
			break;
	}

	// Store original messages
	summary.extra[kExtraDataKey] = {};
	summary.extra[kExtraDataKey][kOriginalMessagesKey] = originalMessages;
	summary.extra[kExtraDataKey][kMessageEstimatedTokenCountKey] = await Promise.all(originalMessages.map(item => stContext.getTokenCountAsync(item.mes)));

	return summary;
}

async function BringIntoView(msgIndex)
{
	if (!gSettings.autoScroll)
		return;

	// Still need sleep since 'chat-scrollto' is not 100% reliable
	await Sleep(100);

	const stContext = SillyTavern.getContext();
	await stContext.executeSlashCommandsWithOptions(`/chat-scrollto ${msgIndex}`);
}

// =========================
// Generation Functions
// =========================

async function SwapToSummaryProfile(stContext, ilsInstance)
{
	const apiMode = stContext.mainApi?.toLowerCase();
	const presetName = gSettings?.apiPresets?.[apiMode] ?? "";

	let useDifferentProfile = gSettings.useDifferentProfile && gSettings.profileName !== "" && gSettings.profileName !== "<None>" && ilsInstance.connProfEnabled;
	let useDifferentApiPreset = gSettings.useDifferentApiPreset && presetName !== "" && ilsInstance.connProfEnabled;

	let success = true;

	let prevProfile = "";
	let prevPreset = "";
	if (useDifferentProfile)
	{
		prevProfile = (await stContext.executeSlashCommandsWithOptions("/profile")).pipe;

		const swapResult = await stContext.executeSlashCommandsWithOptions("/profile " + gSettings.profileName);
		stContext = SillyTavern.getContext(); // Update context just in case
		if (swapResult.isError)
		{
			ShowError("Failed to swap connection profile to:\n" + gSettings.profileName + "\nGeneration Aborted.");
			success = false;
		}
	}

	if (useDifferentApiPreset && success)
	{
		const presetManager = stContext.getPresetManager();
		prevPreset = presetManager.getSelectedPresetName();

		const swapResult = await stContext.executeSlashCommandsWithOptions("/preset " + presetName);
		stContext = SillyTavern.getContext(); // Update context just in case
		if (swapResult.isError)
		{
			ShowError("Failed to swap API Preset " + apiMode + " to:\n" + presetName + "\nGeneration Aborted.");
			success = false;
		}
	}

	return { success, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset };
}

async function SwapBackFromSummaryProfile(stContext, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset)
{
	if (useDifferentProfile)
	{
		const swapResult = await stContext.executeSlashCommandsWithOptions("/profile " + prevProfile);
		if (swapResult.isError)
		{
			ShowError("Failed to restore connection profile to:\n" + gSettings.profileName + "\nPlease check the profile manually.");
		}
	}

	if (useDifferentApiPreset)
	{
		const swapResult = await stContext.executeSlashCommandsWithOptions("/preset " + prevPreset);
		if (swapResult.isError)
		{
			ShowError("Failed to restore preset to:\n" + gSettings.profileName + "\nPlease check the preset manually.");
		}
	}
}

function GetContextSize(stContext)
{
	const apiMode = stContext.mainApi?.toLowerCase();

	switch (apiMode)
	{
		case "textgenerationwebui":
		case "novel":
		case "koboldhorde":
		case "kobold":
			return { ctxOk: true, ctxSize: stContext.maxContext, resSize: textMaxTokens };

		case "openai":
			return { ctxOk: true, ctxSize: stContext.chatCompletionSettings.openai_max_context, resSize: stContext.chatCompletionSettings.openai_max_tokens };

		default:
			ShowError("Unsupported Mode: '" + stContext.mainApi + "'.");
			return { ctxOk: false, ctxSize: 0, resSize: 0 };
	}
}

async function GenerateSummaryAI()
{
	let stContext = SillyTavern.getContext();
	const selection = GetSelection(stContext);
	if (!IsValidRangeSelection(selection))
		return;

	const ilsInstance = GetILSInstance()
	if (ilsInstance.operationLock)
		return;

	ilsInstance.operationLock = true;
	stContext.deactivateSendButtons();

	// Swap Profile
	const { success, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset } = await SwapToSummaryProfile(stContext, ilsInstance);

	if (!success)
	{
		stContext.activateSendButtons();
		ilsInstance.operationLock = false;
		return;
	}

	// Prepare original messages and prompt
	const originalMessages = stContext.chat.slice(selection.start, selection.end + 1);
	const { promptOk, promptText, promptError } = await MakeSummaryPrompt(selection.start, originalMessages, stContext);

	if (!promptOk)
	{
		ShowError("Failed to make summary prompt.\n" + promptError);
		stContext.activateSendButtons();
		ilsInstance.operationLock = false;
		return
	}

	// Start LLM generation asynchronously without awaiting yet
	let promptParams = { prompt: promptText };
	if (gSettings.tokenLimit > 0)
		promptParams.responseLength = gSettings.tokenLimit;

	const responsePromise = stContext.generateRaw(promptParams);

	// create empty summary message while generation runs
	const newSummaryMsg = await CreateEmptySummaryMessage(originalMessages, stContext);
	newSummaryMsg.mes = "Generating...";

	// Delete Originals
	stContext.chat.splice(selection.start, originalMessages.length);
	// Insert summary message into chat and save/reload
	stContext.chat.splice(selection.start, 0, newSummaryMsg);

	await stContext.saveChat();
	await stContext.reloadCurrentChat();

	// Find and update the HTML element for the summary message with a loading spinner
	{
		const summaryMsgElement = document.querySelector(`.mes[mesid="${selection.start}"]`);
		if (summaryMsgElement)
		{
			const mesTextElement = summaryMsgElement.querySelector(".mes_text");
			if (mesTextElement)
			{
				// Create and insert loading spinner
				// We don't need to delete the spinner as reloading the chat will destroy it for us.
				const spinner = MakeSpinner();
				mesTextElement.innerHTML = "";
				mesTextElement.appendChild(spinner);
			}
		}
	}

	BringIntoView(selection.start)

	// Now await for the LLM response to complete
	let response = "";
	try
	{
		response = await responsePromise;
	}
	catch (e)
	{
		console.error("[ILS] Failed to get response from LLM");
		response = "[Failed to get a response]\nThis can happen if Token limit is too low and reasoning uses up all of it.\nCheck console output for full error message.\nRaw Error:\n" + e;
	}

	// Update the summary message in the backend with the generated response
	stContext.chat[selection.start].mes = response;

	// Save and reload to reflect the final response in the UI
	await stContext.saveChat();
	await stContext.reloadCurrentChat();

	await SwapBackFromSummaryProfile(stContext, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset);

	stContext.activateSendButtons();
	ilsInstance.operationLock = false;

	BringIntoView(selection.start);

	ClearSelection(stContext);
}

async function GenerateSummaryManual()
{
	const stContext = SillyTavern.getContext();
	const selection = GetSelection(stContext);
	if (!IsValidRangeSelection(selection))
		return;

	const ilsInstance = GetILSInstance()
	if (ilsInstance.operationLock)
		return;

	ilsInstance.operationLock = true;

	// Prepare original messages and prompt
	const originalMessages = stContext.chat.slice(selection.start, selection.end + 1);

	const newSummaryMsg = await CreateEmptySummaryMessage(originalMessages, stContext);
	newSummaryMsg.mes = "[This is where I'd put the manual summary... if you wrote one!]\nEdit this message and write a summary.";

	// Delete Originals
	stContext.chat.splice(selection.start, originalMessages.length);
	// Add Summary
	stContext.chat.splice(selection.start, 0, newSummaryMsg);

	await stContext.saveChat();
	await stContext.reloadCurrentChat();

	BringIntoView(selection.start);
	ilsInstance.operationLock = false;

	ClearSelection(stContext);
}

// =========================
// Message Action Buttons
// =========================
const kMsgActionButtons = [
	// Select Message Range End
	{
		className: "ils_msg_btn_selectEnd",
		icon: "fa-arrow-right-to-bracket",
		title: "Select Summary End",

		OnClick(msgIndex)
		{
			if (IsOperationLockEngaged())
				return;

			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			selection.end = msgIndex;
			RefreshAllMessageButtons();
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			if (selection.end === null)
				return kMsgBtnColours.default;
			if (msgIndex === selection.end)
				return kMsgBtnColours.selected;
			if (IsMsgInRange(msgIndex, selection))
				return kMsgBtnColours.between;
			return kMsgBtnColours.default;
		}
	},
	// Select Message Range Start
	{
		className: "ils_msg_btn_selectStart",
		icon: "fa-arrow-right-from-bracket",
		title: "Select Summary Start",

		OnClick(msgIndex)
		{
			if (IsOperationLockEngaged())
				return;

			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			selection.start = msgIndex;
			RefreshAllMessageButtons();
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			if (selection.start === null)
				return kMsgBtnColours.default;
			if (msgIndex === selection.start)
				return kMsgBtnColours.selected;
			if (IsMsgInRange(msgIndex, selection))
				return kMsgBtnColours.between;
			return kMsgBtnColours.default;
		}
	},
	// Clear Selection
	{
		className: "ils_msg_btn_clearSel",
		icon: "fa-broom",
		title: "Clear Selection",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsMsgInRange(msgIndex, selection) || selection.start === msgIndex || selection.end === msgIndex;
		},

		OnClick(msgIndex)
		{
			if (IsOperationLockEngaged())
				return;

			const stContext = SillyTavern.getContext();
			ClearSelection(stContext);
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const canClear = selection.start !== null || selection.end !== null;
			return canClear ? kMsgBtnColours.clearable : kMsgBtnColours.default;
		}
	},
	// Summarise Selected Range - LLM
	{
		className: "ils_msg_btn_summarise",
		icon: "fa-robot",
		title: "Summarise (AI)",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			await GenerateSummaryAI();
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const valid = selection.start !== null && selection.end !== null && selection.end > selection.start;
			return valid ? kMsgBtnColours.selected : kMsgBtnColours.default;
		}
	},
	// Summarise Selected Range - Manual
	{
		className: "ils_msg_btn_summarise_manual",
		icon: "fa-user-tag",
		title: "Summarise (Manual)",

		ShowCondition(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			return IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			await GenerateSummaryManual();
		},

		GetColor(msgIndex)
		{
			const stContext = SillyTavern.getContext();
			const selection = GetSelection(stContext);
			const valid = selection.start !== null && selection.end !== null && selection.end > selection.start;
			return valid ? kMsgBtnColours.selected : kMsgBtnColours.default;
		}
	},
];

// =========================
// Header Buttons
// =========================
const kHeaderButtons = [
	// Restore Original Messages
	{
		className: "ils_hrd_btn_restore",
		icon: "fa-file-arrow-up",
		title: "Restore Original and Delete Summary",

		async OnClick(msgIndex)
		{
			const ilsInstance = GetILSInstance()
			if (ilsInstance.operationLock)
				return;

			const stContext = SillyTavern.getContext();

			ilsInstance.operationLock = true;
			stContext.deactivateSendButtons();

			const summaryMsg = GetMessageByIndex(msgIndex, stContext);

			// Technically this being false should be an error, since we shouldn't be able to click restore
			// on a message that doesn't have Original Messages.
			if (HasOriginalMessages(summaryMsg))
			{
				let originals = summaryMsg.extra[kExtraDataKey][kOriginalMessagesKey];

				stContext.chat.splice(msgIndex + 1, 0, ...originals);
				stContext.chat.splice(msgIndex, 1);
			}

			await stContext.saveChat();
			await stContext.reloadCurrentChat();

			stContext.activateSendButtons();
			ilsInstance.operationLock = false;
			ClearSelection(stContext);

			BringIntoView(msgIndex);
		}
	},
	// Regenerate
	{
		className: "ils_hdr_btn_regenerate",
		icon: "fa-robot",
		title: "Re-Summarise (AI)",

		async OnClick(msgIndex)
		{
			let stContext = SillyTavern.getContext();

			const summaryMsg = GetMessageByIndex(msgIndex, stContext);
			if (!HasOriginalMessages(summaryMsg))
				return;

			const ilsInstance = GetILSInstance()
			if (ilsInstance.operationLock)
				return;

			ilsInstance.operationLock = true;
			stContext.deactivateSendButtons();

			// Swap Profile
			const { success, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset } = await SwapToSummaryProfile(stContext, ilsInstance);

			if (!success)
			{
				stContext.activateSendButtons();
				ilsInstance.operationLock = false;
				return;
			}

			const originalMessages = summaryMsg.extra[kExtraDataKey][kOriginalMessagesKey];
			const { promptOk, promptText, promptError } = await MakeSummaryPrompt(msgIndex, originalMessages, stContext);

			if (!promptOk)
			{
				ShowError("Failed to make summary prompt.\n" + promptError);
				stContext.activateSendButtons();
				ilsInstance.operationLock = false;
				return
			}

			let promptParams = { prompt: promptText };
			if (gSettings.tokenLimit > 0)
				promptParams.responseLength = gSettings.tokenLimit;

			const responsePromise = stContext.generateRaw(promptParams);

			summaryMsg.extra[kExtraDataKey][kMessageEstimatedTokenCountKey] = await Promise.all(originalMessages.map(item => stContext.getTokenCountAsync(item.mes)));

			const summaryMsgElement = document.querySelector(`.mes[mesid="${msgIndex}"]`);
			if (summaryMsgElement)
			{
				const mesTextElement = summaryMsgElement.querySelector(".mes_text");
				if (mesTextElement)
				{
					// Create and insert loading spinner
					// We don't need to delete the spinner as reloading the chat will destroy it for us.
					const spinner = MakeSpinner();
					mesTextElement.innerHTML = "";
					mesTextElement.appendChild(spinner);
				}
			}

			// Now await for the LLM response to complete
			let response = "";
			try
			{
				response = await responsePromise;
			}
			catch (e)
			{
				console.error("[ILS] Failed to get response from LLM");
				response = "[Failed to get a response]\nThis can happen if Token limit is too low and reasoning uses up all of it.\nCheck console output for full error message.\nRaw Error:\n"
					+ e
					+ "\n\n[Previous Summary]\n\n"
					+ summaryMsg.mes;
			}

			// Update the summary message in the backend with the generated response
			summaryMsg.mes = response;

			// Save and reload to reflect the final response in the UI
			await stContext.saveChat();
			await stContext.reloadCurrentChat();

			await SwapBackFromSummaryProfile(stContext, useDifferentProfile, prevProfile, useDifferentApiPreset, prevPreset);

			stContext.activateSendButtons();
			ilsInstance.operationLock = false;

			BringIntoView(msgIndex);
		}
	},
];

// =========================
// Message Action Button Rendering
// =========================
function RefreshAllMessageButtons()
{
	document.querySelectorAll(".mes").forEach(node =>
	{
		const msgId = Number(node.getAttribute("mesid"));
		if (!isNaN(msgId))
			RefreshMessageElements(node, msgId);
	});
}

function RefreshMessageElements(messageDiv, msgIndex)
{
	const stContext = SillyTavern.getContext();

	const msgObject = GetMessageByIndex(msgIndex, stContext);
	if (!msgObject)
		return;

	kMsgActionButtons.forEach(def =>
	{
		const msgButton = messageDiv.querySelector("." + def.className);
		if (msgButton)
		{
			msgButton.style.display = (def.ShowCondition && !def.ShowCondition(msgIndex)) ? "none" : null;
			msgButton.style.color = def.GetColor ? def.GetColor(msgIndex) : kMsgBtnColours.default;
		}
	});

	const existingOrigMsgDiv = messageDiv.querySelector(".ils_original_messages_root");
	if (HasOriginalMessages(msgObject))
	{
		if (existingOrigMsgDiv)
		{
			// This is a strange one, for some reason we can end up with a div with a wrong `mesid`
			// And just deleting the existing one seems fine too as the refresh is actually called twice
			// I'm guessing one call might be manual, the other caused by the observer?

			// In any case, I think chat refresh may not destroy all ofthe chat message html elements
			// so some retain the original message blocks

			// We do a few sanity checks and delete the blocks if they're invalid

			// Ensure the correct ID
			if (existingOrigMsgDiv.getAttribute("mesid") != msgIndex)
			{
				existingOrigMsgDiv.remove();
				return;
			}

			// Ensure correct message count
			const containerElement = messageDiv.querySelector(".ils_messages_container_root");
			if (containerElement)
			{
				if (containerElement.getAttribute("msgCount") != msgObject.extra[kExtraDataKey][kOriginalMessagesKey].length)
				{
					existingOrigMsgDiv.remove();
					return;
				}
			}
		}
		else
		{
			const newOrigMsgDiv = document.createElement("div");
			newOrigMsgDiv.className = "ils_original_messages_root";
			newOrigMsgDiv.setAttribute("mesid", msgIndex);

			newOrigMsgDiv.appendChild(CreateOriginalMessagesContainer(msgIndex, msgObject));

			messageDiv.querySelector(".mes_block")?.appendChild(newOrigMsgDiv);
		}
	}
	else if (existingOrigMsgDiv)
	{
		existingOrigMsgDiv.remove();
	}
}

// =========================
// Summary Functions
// =========================

async function MakeSummaryPrompt(msgIndex, originalMessages, stContext)
{
	let { ctxOk, ctxSize, resSize } = GetContextSize(stContext);

	if (!ctxOk)
		return { promptOk: false, promptText: "", promptError: "Could not get context size." };

	if (gSettings.tokenLimit > 0)
		resSize = gSettings.tokenLimit;

	const maxContext = ctxSize - resSize;
	let remainingSize = maxContext;

	// Generate Summary Prompt

	// Add Main Prompt
	const startPrompt = gSettings.startPrompt;
	remainingSize -= await stContext.getTokenCountAsync(startPrompt);

	// Setup Mid-Prompt
	const midPrompt = (gSettings.midPrompt !== "") ? "\n" + gSettings.midPrompt : "";
	remainingSize -= await stContext.getTokenCountAsync(midPrompt);

	// Setup End-Prompt
	const endPrompt = (gSettings.endPrompt !== "") ? "\n" + gSettings.endPrompt : "";
	remainingSize -= await stContext.getTokenCountAsync(endPrompt);

	// Check if Prompt fits
	if (remainingSize < 0)
		return { promptOk: false, promptText: "", promptError: "Prompt instructions too big for context: " + (maxContext - remainingSize) + " of " + maxContext + "." };

	// - Content to Summarise
	let messagesToSummarise = "";
	for (const msg of originalMessages)
	{
		if (!msg.is_system)
		{
			const msgText = msg.mes.trim();
			if (msgText.length > 0)
				messagesToSummarise += "\n" + msgText;
		}
	}
	if (messagesToSummarise.length == 0)
		return { promptOk: false, promptText: "", promptError: "No messages to summarise. Are all messages in the selected range hidden or blank?" };

	messagesToSummarise = "\n" + gSettings.summariseStartMarker + messagesToSummarise + "\n" + gSettings.summariseEndMarker;
	remainingSize -= await stContext.getTokenCountAsync(messagesToSummarise);

	if (remainingSize < 0)
		return { promptOk: false, promptText: "", promptError: "Too many messages for context: " + (maxContext - remainingSize) + " of " + maxContext + "." };

	// Historic Context
	let historicContex = "";
	let histContextStart = 0;
	if (gSettings.historicalContexDepth >= 0)
	{
		histContextStart = msgIndex - gSettings.historicalContexDepth;
		if (histContextStart < 0)
			histContextStart = 0;
	}

	const histCtxLabels = "\n" + gSettings.historicalContextStartMarker + "\n" + gSettings.historicalContextEndMarker;

	for (let i = msgIndex - 1; i >= histContextStart; --i)
	{
		const msg = GetMessageByIndex(i, stContext);
		if (!msg.is_system)
		{
			const msgText = msg.mes.trim();
			if (msgText.length > 0)
			{
				const tokenCost = await stContext.getTokenCountAsync(histCtxLabels + msgText);
				if ((remainingSize - tokenCost) > 0)
				{
					historicContex = msgText + historicContex;
				}
				// Context too full
				else
				{
					break;
				}
			}
		}
	}

	// Append Historic Context
	const summaryPrompt = startPrompt
		+ "\n" + gSettings.historicalContextStartMarker + historicContex + "\n" + gSettings.historicalContextEndMarker
		+ midPrompt
		+ messagesToSummarise
		+ endPrompt;

	const finalSize = await stContext.getTokenCountAsync(summaryPrompt);
	if (finalSize > maxContext)
		return { promptOk: false, promptText: "", promptError: "Final summary prompt exceeded context: " + (maxContext - remainingSize) + " of " + maxContext + "." };

	return { promptOk: true, promptText: summaryPrompt, promptError: "" };
}

// =========================
// Original Message Display Handling
// =========================
function GetMessageFromPath(path, stContext)
{
	if (!Array.isArray(path) || path.length === 0)
		return null;

	const [msgIndex, ...subpath] = path;

	let msg = GetMessageByIndex(msgIndex, stContext);
	if (!msg || !HasOriginalMessages(msg))
		return null;

	for (const index of subpath)
	{
		if (!HasOriginalMessages(msg))
			return null;

		msg = msg.extra[kExtraDataKey][kOriginalMessagesKey][index];
		if (!msg)
			return null;
	}

	return msg;
}

function CreateOriginalMessagesContainer(msgIndex, msgObject, depth = 0, path = [])
{
	const originals = (msgObject.extra && msgObject.extra[kExtraDataKey] && Array.isArray(msgObject.extra[kExtraDataKey][kOriginalMessagesKey]))
		? msgObject.extra[kExtraDataKey][kOriginalMessagesKey]
		: [];

	const containerRoot = document.createElement("div");
	containerRoot.setAttribute("msgCount", originals.length);
	containerRoot.className = "ils_messages_container_root";
	containerRoot.style.borderLeft = `2px solid ${GetDepthColour(depth)}`;
	containerRoot.style.paddingLeft = "2px";

	// Header (flex with label on left and expand icon on right)
	const containerHeader = document.createElement("div");
	containerHeader.className = "ils_msg_container_header";
	containerHeader.setAttribute("ils-msg-depth", depth);
	containerHeader.setAttribute("ils-msg-index", msgIndex);
	containerHeader.setAttribute("ils-msg-path", JSON.stringify([...path, msgIndex]));
	containerHeader.style.background = `linear-gradient(90deg, ${GetDepthColourWithAlpha(depth, 0.3)}, transparent)`;
	containerHeader.style.border = `1px solid ${GetDepthColourWithAlpha(depth, 0.12)}`;

	const buttonsDiv = document.createElement("div");
	if (depth === 0)
	{
		kHeaderButtons.forEach(def =>
		{
			const btn = document.createElement("div");
			btn.className = `mes_button fa-solid ${def.icon} interactable ${def.className}`;
			btn.setAttribute("mesid", msgIndex);
			btn.title = def.title;
			btn.tabIndex = 0;

			buttonsDiv.appendChild(btn);
		});
	}
	containerHeader.appendChild(buttonsDiv);

	const headerLabel = document.createElement("div");
	let origTokens = 0;
	let visMsg = 0;
	for (let i = 0; i < originals.length; ++i)
	{
		const msg = originals[i];

		if (msg?.is_system)
			continue;

		visMsg++;

		const cachedTokenCount = msgObject?.extra?.[kExtraDataKey]?.[kMessageEstimatedTokenCountKey]?.[i];
		// token_count does include reasoning, which we do not summarise, so only use it on chats where we do our own maths.
		origTokens += Number((cachedTokenCount == null) ? (msg?.extra?.token_count ?? 0) : cachedTokenCount) || 0;
	}
	headerLabel.textContent = `Original Messages: ${visMsg}/${originals.length} used | ~${origTokens} tokens`;

	const expandIcon = document.createElement("div");
	expandIcon.className = "ils_expand_icon mes_button fa-solid fa-caret-right";

	containerHeader.appendChild(headerLabel);
	containerHeader.appendChild(expandIcon);

	// Contents - Empty by default, filled in when expanding
	const containerContents = document.createElement("div");
	containerContents.className = "ils_msg_container_contents";
	containerContents.setAttribute("ils-msg-depth", depth);

	// Add to root
	containerRoot.appendChild(containerHeader);
	containerRoot.appendChild(containerContents);

	return containerRoot;
}

function CreateOriginalMessageBody(msgIndex, msgObject, stContext, depth = 0, path = [])
{
	const messageRoot = document.createElement("div");
	messageRoot.className = "ils_original_message";
	messageRoot.style.border = `1px solid ${GetDepthColourWithAlpha(depth, 0.18)}`;

	const headerRow = document.createElement("div");
	headerRow.className = "ils_original_message_header";

	const nameSpan = document.createElement("span");
	nameSpan.className = "name_text";
	nameSpan.textContent = msgObject.name || "Unknown";

	const indexSpan = document.createElement("small");
	indexSpan.className = "mesIDDisplay";
	indexSpan.textContent = `[${msgIndex}]`;

	headerRow.appendChild(nameSpan);
	headerRow.appendChild(indexSpan);

	messageRoot.appendChild(headerRow);

	const contentDiv = document.createElement("div");
	contentDiv.className = "ils_mes_text";

	// Rewrite this part to be better
	if (Array.isArray(msgObject.extra?.media) && msgObject.extra.media.length > 0)
	{
		const mediaArray = msgObject.extra.media;
		const requestedIndex = Number.isInteger(msgObject.extra.media_index) ? msgObject.extra.media_index : 0;
		const safeIndex = (requestedIndex >= 0 && requestedIndex < mediaArray.length) ? requestedIndex : 0;

		const mediaItem = mediaArray[safeIndex];
		if (mediaItem?.url)
		{
			const imgElem = document.createElement("img");
			imgElem.className = "ils_mes_img";
			imgElem.src = mediaItem.url;
			contentDiv.appendChild(imgElem);
		}
	}
	else
	{
		contentDiv.innerHTML = stContext.messageFormatting(msgObject.mes || "(empty message)", msgObject.name || "Unknown", msgObject.is_system, msgObject.is_user, 0);
	}

	messageRoot.appendChild(contentDiv);

	if (HasOriginalMessages(msgObject))
	{
		messageRoot.appendChild(CreateOriginalMessagesContainer(msgIndex, msgObject, depth + 1, path));
	}

	return messageRoot;
}

function HandleMessagesHeaderClick(containerHeaderDiv)
{
	const stContext = SillyTavern.getContext();

	const msgDepth = Number(containerHeaderDiv.getAttribute("ils-msg-depth"));
	const msgIndex = Number(containerHeaderDiv.getAttribute("ils-msg-index"));
	const pathStr = containerHeaderDiv.getAttribute("ils-msg-path");

	if (isNaN(msgDepth) || isNaN(msgIndex))
		return;

	const containerContents = containerHeaderDiv.parentElement.querySelector(".ils_msg_container_contents");
	if (!containerContents)
		return;

	const expandIcon = containerHeaderDiv.querySelector('.ils_expand_icon');

	if (containerContents.childNodes.length === 0)
	{
		let path;
		try
		{
			path = JSON.parse(pathStr);
		}
		catch (e)
		{
			console.error("[ILS] Failed to parse message path:", e);
			return;
		}

		const msgObject = GetMessageFromPath(path, stContext);
		if (!msgObject)
			return;

		const messages = (msgObject.extra && msgObject.extra[kExtraDataKey] && Array.isArray(msgObject.extra[kExtraDataKey][kOriginalMessagesKey]))
			? msgObject.extra[kExtraDataKey][kOriginalMessagesKey]
			: [];

		messages.forEach((orgiMsg, origIndex) =>
		{
			const origMsgBody = CreateOriginalMessageBody(origIndex, orgiMsg, stContext, msgDepth + 1, path);
			if (origMsgBody)
				containerContents.appendChild(origMsgBody);
		});

		if (expandIcon)
			expandIcon.className = "ils_expand_icon mes_button fa-solid fa-caret-down";
	}
	else
	{
		containerContents.innerHTML = "";
		if (expandIcon)
			expandIcon.className = "ils_expand_icon mes_button fa-solid fa-caret-right";
	}
}

// =========================
// Event Handlers
// =========================
function MainClickHandler(e)
{
	// Header Buttons
	for (const def of kHeaderButtons)
	{
		const btn = e.target.closest("." + def.className);
		if (btn)
		{
			const msgIndex = Number(btn.getAttribute("mesid"));
			if (!isNaN(msgIndex))
			{
				def.OnClick(msgIndex);
				return;
			}
		}
	}

	// Header Click
	const containerHeaderDiv = e.target.closest(".ils_msg_container_header");
	if (containerHeaderDiv)
	{
		HandleMessagesHeaderClick(containerHeaderDiv);
		return;
	}

	// Message Action Buttons
	const btn = e.target.closest(".mes_button");
	if (!btn)
		return;

	const messageDiv = e.target.closest(".mes");
	if (!messageDiv)
		return;

	const messageId = Number(messageDiv.getAttribute("mesid"));
	if (isNaN(messageId))
		return;

	for (const def of kMsgActionButtons)
	{
		if (btn.classList.contains(def.className))
		{
			def.OnClick(messageId);
			break;
		}
	}
}

function OnChatChanged(data)
{
	ClearSelection(SillyTavern.getContext());
}

function OnMoreMsgLoaded(data)
{
	RefreshAllMessageButtons();
}

function OnMainApiChanged(data)
{
	UpdateSettingsUI();
}

// =========================
// Slash Command Handling
// =========================
async function SummariseCommand(namedArgs, unnamedArgs)
{
	const stContext = SillyTavern.getContext();
	const selection = GetSelection(stContext);

	const idParams = String(unnamedArgs).split(' ');

	selection.start = idParams[0] ? Math.max(0, parseInt(idParams[0], 10)) : null;
	selection.end = idParams[1] ? Math.min(parseInt(idParams[1], 10), stContext.chat.length - 1) : null;

	if (!IsValidRangeSelection(selection))
	{
		toastr.error("[ILS] Invalid message range: " + String(selection.start) + " - " + String(selection.end));
		ClearSelection(stContext);
		return "";
	}

	const manualMode = String(namedArgs.manual).trim().toLowerCase();
	if (manualMode == "true")
		await GenerateSummaryManual();
	else
		await GenerateSummaryAI();
	return "";
}

// =========================
// Settings Handling
// =========================
async function UpdateSettingsUI()
{
	const stContext = SillyTavern.getContext();
	const ilsInstance = GetILSInstance();

	$("#ils_setting_hist_ctx_depth").val(gSettings.historicalContexDepth);
	$("#ils_setting_hist_ctx_start").val(gSettings.historicalContextStartMarker);
	$("#ils_setting_hist_ctx_end").val(gSettings.historicalContextEndMarker);
	$("#ils_setting_summ_cont_start").val(gSettings.summariseStartMarker);
	$("#ils_setting_summ_cont_end").val(gSettings.summariseEndMarker);
	$("#ils_setting_prompt_main").val(gSettings.startPrompt);
	$("#ils_setting_prompt_mid").val(gSettings.midPrompt);
	$("#ils_setting_prompt_end").val(gSettings.endPrompt);
	$("#ils_setting_token_limit").val(gSettings.tokenLimit);
	$("#ils_setting_smr_name_custom_val").val(gSettings.summaryName);
	$("#ils_setting_auto_scroll").prop("checked", gSettings.autoScroll);
	$("#ils_setting_use_different_profile").prop("checked", gSettings.useDifferentProfile);
	$("#ils_setting_use_specified_api_preset").prop("checked", gSettings.useDifferentApiPreset);

	const radio = document.querySelector(`input[name="ils_setting_radio_smr_name"][value="${gSettings.summaryNameMode}"]`);
	if (radio)
		radio.checked = true;

	const spDropdown = $("#ils_setting_sp_combo");
	if (spDropdown && spDropdown.length)
	{
		spDropdown.empty();
		spDropdown.append($('<option>', { value: 'Default', text: 'Default' }));

		stContext.extensionSettings[kExtensionName] ??= {};
		let rootSettings = stContext.extensionSettings[kExtensionName];
		rootSettings.spData ??= {};

		for (const [custompreset] of Object.entries(rootSettings.spData))
		{
			spDropdown.append($('<option>', { value: custompreset, text: custompreset }));
		}
		spDropdown.val(gSpName);
	}

	// Do Connection Profile stuff last so we can early return on errors
	const connectionManagerRes = await stContext.executeSlashCommandsWithOptions("/extension-state connection-manager");
	if (connectionManagerRes.pipe != "true")
	{
		$("#ils_setting_use_different_profile").prop("disabled", true);
		$("#ils_setting_use_specified_api_preset").prop("disabled", true);
		$("#ils_setting_connection_profile").prop("disabled", true);
		$("#ils_setting_chat_completion_preset").prop("disabled", true);

		ilsInstance.connProfEnabled = false;
		return;
	}
	else
	{
		ilsInstance.connProfEnabled = true;
	}

	let profileListRes = null;
	try
	{
		profileListRes = await stContext.executeSlashCommandsWithOptions("/profile-list", { handleParserErrors: false });
	}
	catch (e)
	{
		ShowError("Failed to run '/profile-list'.\nIs the 'Connection Profiles' extension enabled?", e);
		return;
	}

	if (profileListRes == null || profileListRes.isError)
	{
		ShowError("Failed to fetch Connection Profile list.");
		return;
	}

	try
	{
		const profileDropdown = $("#ils_setting_connection_profile");
		if (profileDropdown && profileDropdown.length)
		{
			profileDropdown.empty();
			profileDropdown.append($('<option>', { value: '<None>', text: '<None>' }));

			const profileList = JSON.parse(profileListRes.pipe);

			if (Array.isArray(profileList))
			{
				for (const profName of profileList)
					profileDropdown.append($('<option>', { value: profName, text: profName }));
			}

			if (gSettings.profileName && gSettings.profileName !== "" && profileList && profileList.includes(gSettings.profileName))
			{
				profileDropdown.val(gSettings.profileName);
			}
			else if (gSettings.profileName !== "<None>")
			{
				if (gSettings.useDifferentProfile)
				{
					gSettings.useDifferentProfile = false;
					$("#ils_setting_use_different_profile").prop("checked", gSettings.useDifferentProfile);
					profileDropdown.val("<None>");
					stContext.saveSettingsDebounced();
					ShowWarning("Selected Connection Profile: '" + gSettings.profileName + "' not found.\nUsing different profile has been disabled and reverted to <None>.");
				}
			}
		}
	}
	catch (e)
	{
		ShowError("Failed to populate connection profile dropdown.", e)
	}

	const presetManager = stContext.getPresetManager();
	const apiMode = stContext.mainApi?.toLowerCase();

	try
	{
		const presetDropdown = $("#ils_setting_chat_completion_preset");
		if (presetDropdown && presetDropdown.length)
		{
			presetDropdown.empty();

			const presetNames = presetManager.getPresetList().preset_names;
			const presetList = Object.keys(presetNames);
			const presetName = gSettings?.apiPresets?.[apiMode] ?? "";

			switch (apiMode)
			{
				case "textgenerationwebui":
					{
						// Text Gen is 'Int - Name' pairs
						for (const presetId of presetList)
							presetDropdown.append($('<option>', { value: presetNames[presetId], text: presetNames[presetId] }));
					}
					break;
				case "openai":
				case "novel":
				case "koboldhorde":
				case "kobold":
					{
						// These APIs are  'Name - Int' pairs
						for (const presName of presetList)
							presetDropdown.append($('<option>', { value: presName, text: presName }));
					}
					break;
				default:
					ShowError("Unknow API Mode: " + apiMode);
					break
			}

			if (presetName != "" && presetList.includes(presetName))
			{
				presetDropdown.val(presetName);
			}
			else
			{
				if (gSettings.useDifferentApiPreset)
				{
					gSettings.useDifferentApiPreset = false;
					$("#ils_setting_use_specified_api_preset").prop("checked", gSettings.useDifferentApiPreset);
					stContext.saveSettingsDebounced();
					ShowWarning("Selected API Preset (" + apiMode + "): '" + presetName + "' not found.\nUsing different preset has been disabled.");
				}
			}
		}
	}
	catch (e)
	{
		ShowError("Failed to populate Preset dropdown.", e);
	}
}

function Debounce(fn, delay)
{
	let timeout;
	return function (...args)
	{
		clearTimeout(timeout);
		timeout = setTimeout(() => fn.apply(this, args), delay);
	};
}

async function SwapProfile(profileName)
{
	const stContext = SillyTavern.getContext();

	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spName = profileName;

	// Reload
	[gSettings, gSpName] = await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

function OnSettingChanged(event)
{
	const id = event.target.id;
	const val = event.target.value;

	switch (id)
	{
		case "ils_setting_sp_combo":
			SwapProfile(val);
			break;
		case "ils_setting_hist_ctx_depth":
			{
				const parsed = parseInt(val, 10);
				gSettings.historicalContexDepth = Number.isNaN(parsed) ? -1 : parsed;
			}
			break;
		case "ils_setting_token_limit":
			{
				const parsed = parseInt(val, 10);
				gSettings.tokenLimit = Number.isNaN(parsed) ? 0 : parsed;
			}
			break;
		case "ils_setting_hist_ctx_start":
			gSettings.historicalContextStartMarker = val;
			break;
		case "ils_setting_hist_ctx_end":
			gSettings.historicalContextEndMarker = val;
			break;
		case "ils_setting_summ_cont_start":
			gSettings.summariseStartMarker = val;
			break;
		case "ils_setting_summ_cont_end":
			gSettings.summariseEndMarker = val;
			break;
		case "ils_setting_prompt_main":
			gSettings.startPrompt = val;
			break;
		case "ils_setting_prompt_mid":
			gSettings.midPrompt = val;
			break;
		case "ils_setting_prompt_end":
			gSettings.endPrompt = val;
			break;
		case "ils_setting_use_different_profile":
			gSettings.useDifferentProfile = event.target.checked;
			break;
		case "ils_setting_connection_profile":
			gSettings.profileName = val;
			break;
		case "ils_setting_use_specified_api_preset":
			gSettings.useDifferentApiPreset = event.target.checked;
			break;
		case "ils_setting_chat_completion_preset":
			{
				const stContext = SillyTavern.getContext();
				const apiMode = stContext.mainApi?.toLowerCase();
				gSettings.apiPresets ??= {};
				gSettings.apiPresets[apiMode] = val;
			}
			break;
		case "ils_setting_auto_scroll":
			gSettings.autoScroll = event.target.checked;
			break;
		case "ils_setting_smr_name_mode_user":
		case "ils_setting_smr_name_mode_char":
		case "ils_setting_smr_name_mode_custom":
			{
				const selected = document.querySelector('input[name="ils_setting_radio_smr_name"]:checked');
				if (selected)
					gSettings.summaryNameMode = selected.value;
			}
			break;
		case "ils_setting_smr_name_custom_val":
			gSettings.summaryName = val;
			break;
		default:
			return; // unknown setting
	}

	const stContext = SillyTavern.getContext();
	stContext.saveSettingsDebounced();
}

async function OnSettingSpNew()
{
	const stContext = SillyTavern.getContext();

	const nameInput = await Popup.show.input("New Preset", "Enter preset name:", "");
	if (!nameInput || nameInput.length == 0)
		return;

	const spName = (await getSanitizedFilename(nameInput)).trim();
	if (!spName || spName.length == 0)
		return;

	// Create new Entry
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spName = spName;
	rootSettings.spData ??= {};
	rootSettings.spData[rootSettings.spName] = {};

	// Reload
	[gSettings, gSpName] = await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

async function OnSettingSpDelete()
{
	if (gSpName === "Default")
	{
		ShowError("'Default' settings preset cannot be deleted.");
		return;
	}

	const confirm = await Popup.show.confirm("Confirmation", "Are you use you want to delete '" + gSpName + "'?");
	if (confirm !== POPUP_RESULT.AFFIRMATIVE)
		return;

	const spName = gSpName;

	const stContext = SillyTavern.getContext();

	// Set active preset to default
	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spName = "Default";

	// Reload settings
	[gSettings, gSpName] = await LoadSettings(stContext);

	// Delete old preset
	delete rootSettings.spData[spName];

	// Refresh
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

async function OnSettingSpImportClick()
{
	$('#ils_setting_sp_import_file').trigger('click');
}

async function OnSettingSpImportFile(e)
{
	if (!(e.target instanceof HTMLInputElement))
		return;

	if (!e.target.files.length)
		return;

	const file = e.target.files[0];
	const fullName = file.name;

	if (!fullName.toLowerCase().endsWith(".json"))
	{
		ShowError("Please pick a json file.")
		return;
	}

	const stContext = SillyTavern.getContext();
	let baseName = fullName.slice(0, -5);

	let data = {};

	stContext.extensionSettings[kExtensionName] ??= {};
	let rootSettings = stContext.extensionSettings[kExtensionName];
	rootSettings.spData ??= {};

	if (rootSettings.spData[baseName] || baseName === "Default")
	{
		let i = 1;
		while (rootSettings.spData[`${baseName} (${i})`])
			++i;

		baseName = `${baseName} (${i})`;
	}

	try
	{
		const text = await file.text();
		data = JSON.parse(text);
	}
	catch (err)
	{
		console.error("Failed to read or parse file:", err);
	}

	let newSettings = {};
	Object.keys(data).forEach(key => { if (Object.hasOwn(kDefaultSettings, key)) newSettings[key] = data[key]; });
	rootSettings.spData[baseName] = newSettings;
	rootSettings.spName = baseName;

	// Reload
	[gSettings, gSpName] = await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

async function OnSettingSpExport()
{
	let settings = {};
	Object.keys(gSettings).forEach(key => { if (Object.hasOwn(kDefaultSettings, key)) settings[key] = gSettings[key]; });
	download(JSON.stringify(settings, null, "\t"), gSpName + ".json", "application/json");
}

async function OnSettingSpResetToDefault()
{
	const confirm = await Popup.show.confirm("Confirmation", "Are you use you reset '" + gSpName + "' to default settings?");
	if (confirm !== POPUP_RESULT.AFFIRMATIVE)
		return;

	const stContext = SillyTavern.getContext();

	// Delete Keys, except for preset specific ones
	const keysToKeep = gSpName === "Default" ? new Set(["spName", "spData"]) : new Set();
	Object.keys(gSettings).forEach(key => { if (!keysToKeep.has(key)) delete gSettings[key]; });

	// Reload
	[gSettings, gSpName] = await LoadSettings(stContext);
	stContext.saveSettingsDebounced();
	UpdateSettingsUI();
}

// =========================
// Initialise
// =========================
jQuery(async () =>
{
	const stContext = SillyTavern.getContext();
	const ilsInstance = GetILSInstance();

	[gSettings, gSpName] = await LoadSettings(stContext);

	// Setup Settings Menu
	const settingsHtml = await $.get(kSettingsFile);

	const $extensions = $("#extensions_settings");
	const $existing = $extensions.find(".inline-summary-settings");
	if ($existing.length > 0)
		$existing.replaceWith(settingsHtml);
	else
		$extensions.append(settingsHtml);

	// Fill In setting values
	await UpdateSettingsUI();

	// Setup setting change handlers
	$("#ils_setting_sp_combo").on("input", OnSettingChanged);
	$("#ils_setting_hist_ctx_depth").on("input", OnSettingChanged);
	$("#ils_setting_hist_ctx_start").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_hist_ctx_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_summ_cont_start").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_summ_cont_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_main").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_mid").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_smr_name_custom_val").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_token_limit").on("input", OnSettingChanged);
	$("#ils_setting_use_different_profile").on("change", OnSettingChanged);
	$("#ils_setting_connection_profile").on("input", OnSettingChanged);
	$("#ils_setting_use_specified_api_preset").on("change", OnSettingChanged);
	$("#ils_setting_chat_completion_preset").on("input", OnSettingChanged);
	$("#ils_setting_smr_name_mode_user").on("change", OnSettingChanged);
	$("#ils_setting_smr_name_mode_char").on("change", OnSettingChanged);
	$("#ils_setting_smr_name_mode_custom").on("change", OnSettingChanged);
	$("#ils_setting_auto_scroll").on("change", OnSettingChanged);

	$("#ils_setting_sp_new").on("click", OnSettingSpNew);
	$("#ils_setting_sp_delete").on("click", OnSettingSpDelete);
	$("#ils_setting_sp_import").on("click", OnSettingSpImportClick);
	$("#ils_setting_sp_export").on("click", OnSettingSpExport);
	$("#ils_setting_sp_reset_default").on("click", OnSettingSpResetToDefault);

	$("#ils_setting_sp_import_file").on("change", OnSettingSpImportFile);

	// Message Action Buttons
	const templateContainer = document.querySelector("#message_template .mes_buttons .extraMesButtons");
	if (templateContainer)
	{
		// Prepend buttons, this will result in reverse ordering, but it will be to the left of the button list.
		kMsgActionButtons.forEach(def =>
		{
			if (templateContainer.querySelector("." + def.className))
				return;

			const btn = document.createElement("div");
			btn.className = `mes_button fa-solid ${def.icon} interactable ${def.className}`;
			btn.title = def.title;
			btn.tabIndex = 0;
			btn.style.color = kMsgBtnColours.default;

			templateContainer.prepend(btn);
		});
	}
	else
	{
		console.error("[ILS] Could not find message template to inject buttons");
	}

	// Chat Observer
	const chatContainer = document.getElementById("chat");
	if (chatContainer)
	{
		if (ilsInstance.chatObs)
			ilsInstance.chatObs.disconnect();

		ilsInstance.chatObs = new MutationObserver(mutations =>
		{
			for (const m of mutations)
			{
				for (const node of m.addedNodes)
				{
					if (node.classList?.contains("mes"))
					{
						const msgId = Number(node.getAttribute("mesid"));
						if (!isNaN(msgId))
							RefreshMessageElements(node, msgId);
					}
				}
			}
		});

		ilsInstance.chatObs.observe(chatContainer, { childList: true, subtree: true });
	}
	else
	{
		console.error("[ILS] Failed to setup Observer.")
	}

	// Other Events
	const kEventsToRegister = [
		{ type: stContext.eventTypes.CHAT_CHANGED, handler: OnChatChanged },
		{ type: stContext.eventTypes.MORE_MESSAGES_LOADED, handler: OnMoreMsgLoaded },
		{ type: stContext.eventTypes.MAIN_API_CHANGED, handler: OnMainApiChanged },
	];

	for (const { type, handler } of kEventsToRegister)
	{
		const flagName = `evt_${type}_registered`;
		if (!ilsInstance[flagName])
		{
			stContext.eventSource.on(type, handler);
			ilsInstance[flagName] = true;
		}
	}

	document.removeEventListener("click", MainClickHandler);
	document.addEventListener("click", MainClickHandler);

	stContext.SlashCommandParser.addCommandObject(stContext.SlashCommand.fromProps({
		name: "ils-summarise",
		callback: SummariseCommand,
		namedArgumentList: [
			stContext.SlashCommandNamedArgument.fromProps({
				name: 'manual',
				description: 'Insert manual summary message instead of using AI.',
				typeList: stContext.ARGUMENT_TYPE.BOOLEAN,
				defaultValue: 'false',
			}),
		],
		unnamedArgumentList: [
			stContext.SlashCommandArgument.fromProps({
				description: 'First message index',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
			stContext.SlashCommandArgument.fromProps({
				description: 'Last message index',
				typeList: stContext.ARGUMENT_TYPE.NUMBER,
				isRequired: true,
			}),
		],
		helpString: `
		<div>
			Summarise the specified range of messages using AI. Inclusive range, must be at least 2 mesages long.
		</div>
		<div>
			<strong>Examples:</strong>
			<pre><code class="language-stscript">/ils-summarise 8 16</code></pre>
			<pre><code class="language-stscript">/ils-summarise manual=true 10 20</code></pre>
		</div>
	`
	}));

	console.log("[ILS] Inline Summary - Ready");
});
