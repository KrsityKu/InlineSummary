//  SillyTavern - Inline Summaries Extension

// =========================
// Constants
// =========================
const kExtensionName = "InlineSummary";
const kExtensionFolderPath = `scripts/extensions/third-party/${kExtensionName}`;
const kSettingsFile = `${kExtensionFolderPath}/settings.html`;
const kDefaultsFile = `${kExtensionFolderPath}/defaults.json`;
const kExtraDataKey = "ILS_Data";
const kOriginalMessagesKey = "OriginalMessages";

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
	sumariseStartMarker: "<Content_To_Summarise>",
	sumariseEndMarker: "</Content_To_Summarise>",
	tokenLimit: 0,
	useDifferentProfile: false,
	profileName: "<None>",
	useDifferentPreset: false,
	presetName: ""
});

// =========================
// Includes/API/Globals
// =========================

const gST = SillyTavern.getContext();
let gSettings = {};

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

function GetMessageByIndex(msgIndex)
{
	return gST.chat[msgIndex];
}

// =========================
// Selection Helpers
// =========================
function GetSelection()
{
	if (!gST.chatMetadata.ils_selection)
		gST.chatMetadata.ils_selection = { start: null, end: null };
	return gST.chatMetadata.ils_selection;
}

function ClearSelection()
{
	gST.chatMetadata.ils_selection = { start: null, end: null };
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
async function LoadSettings()
{
	if (!gST.extensionSettings[kExtensionName])
		gST.extensionSettings[kExtensionName] = {};

	for (const settingKey of Object.keys(kDefaultSettings))
	{
		if (!Object.hasOwn(gST.extensionSettings[kExtensionName], settingKey))
		{
			if (settingKey == "startPrompt")
			{
				const defaultsJson = await $.get(kDefaultsFile);
				gST.extensionSettings[kExtensionName].startPrompt = defaultsJson.defaultPrompt;
			}
			else
			{
				gST.extensionSettings[kExtensionName][settingKey] = kDefaultSettings[settingKey];
			}
		}
	}

	return gST.extensionSettings[kExtensionName];
}

function SaveSettings()
{
	gST.saveSettingsDebounced();
}

// =========================
// Chat Message Functions
// =========================
function HasOriginalMessages(msgObject)
{
	return msgObject && msgObject.extra && msgObject.extra[kExtraDataKey] && Array.isArray(msgObject.extra[kExtraDataKey][kOriginalMessagesKey]);
}

function CreateEmptySummaryMessage(originalMessages)
{
	const summary = {
		name: "Summary",
		is_user: false,
		is_system: false,
		mes: "Generating...",
		extra: {}
	};

	// Store original messages
	summary.extra[kExtraDataKey] = {};
	summary.extra[kExtraDataKey][kOriginalMessagesKey] = originalMessages;

	return summary;
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
			const selection = GetSelection();
			selection.end = msgIndex;
			RefreshAllMessageButtons();
		},

		GetColor(msgIndex)
		{
			const selection = GetSelection();
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
			const selection = GetSelection();
			selection.start = msgIndex;
			RefreshAllMessageButtons();
		},

		GetColor(msgIndex)
		{
			const selection = GetSelection();
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
			const selection = GetSelection();
			return IsMsgInRange(msgIndex, selection) || selection.start === msgIndex || selection.end === msgIndex;
		},

		OnClick(msgIndex)
		{
			ClearSelection();
		},

		GetColor(msgIndex)
		{
			const selection = GetSelection();
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
			const selection = GetSelection();
			return IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			const selection = GetSelection();
			if (!IsValidRangeSelection(selection))
				return;

			// Prepare original messages and prompt
			const originalMessages = gST.chat.slice(selection.start, selection.end + 1);
			const summaryPrompt = MakeSummaryPrompt(selection.start, originalMessages);

			gST.deactivateSendButtons();

			let useDifferentProfile = gSettings.useDifferentProfile && gSettings.profileName !== "" && gSettings.profileName !== "<None>";
			let useDifferentPreset = gSettings.useDifferentPreset && gSettings.presetName !== "";

			let prevProfile = "";
			let prevPreset = "";
			if (useDifferentProfile)
			{
				prevProfile = (await gST.executeSlashCommands("/profile")).pipe;

				const swapResult = await gST.executeSlashCommands("/profile " + gSettings.profileName);
				if (swapResult.isError)
				{
					Console.error("[ILS] Failed to swap connection profile to: " + gSettings.profileName);
					gST.callGenericPopup("[ILS] Failed to swap connection profile to:\n" + gSettings.profileName + "\nGeneration Aborted.", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
					gST.activateSendButtons();
					return;
				}
			}

			if (useDifferentPreset)
			{
				const presetManager = gST.getPresetManager();
				prevPreset = presetManager.getSelectedPresetName();

				const swapResult = await gST.executeSlashCommands("/preset " + gSettings.presetName);
				if (swapResult.isError)
				{
					Console.error("[ILS] Failed to swap preset to: " + gSettings.presetName);
					gST.callGenericPopup("[ILS] Failed to swap connection profile to:\n" + gSettings.presetName + "\nGeneration Aborted.", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
					gST.activateSendButtons();
					return;
				}
			}

			// Start LLM generation asynchronously without awaiting yet
			let promptParams = { prompt: summaryPrompt };
			if (gSettings.tokenLimit > 0)
				promptParams.responseLength = gSettings.tokenLimit;

			const responsePromise = gST.generateRaw(promptParams);

			// create empty summary message while generation runs
			const newSummaryMsg = CreateEmptySummaryMessage(originalMessages);
			newSummaryMsg.mes = "Generating...";

			// Delete Originals
			gST.chat.splice(selection.start, originalMessages.length);
			// Insert summary message into chat and save/reload
			gST.chat.splice(selection.start, 0, newSummaryMsg);

			await gST.saveChat();
			await gST.reloadCurrentChat();

			// Find and update the HTML element for the summary message with a loading spinner
			const summaryMsgElement = document.querySelector(`.mes[mesid="${selection.start}"]`);
			if (summaryMsgElement)
			{
				const mesTextElement = summaryMsgElement.querySelector(".mes_text");
				if (mesTextElement)
				{
					// Create and insert loading spinner
					// We don't need to delete the spinner as reloading the chat will destroy it for us.
					const spinner = document.createElement("div");
					spinner.className = "ils_loading_spinner";
					spinner.innerHTML = '<i class="fa-solid fa-spinner"></i>';
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
				response = "[Failed to get a response]\nThis can happen if Token limit is too low and reasoning uses up all of it.\nRaw Error:\n" + e;
			}

			// Update the summary message in the backend with the generated response
			gST.chat[selection.start].mes = response;

			// Save and reload to reflect the final response in the UI
			await gST.saveChat();
			await gST.reloadCurrentChat();

			if (useDifferentProfile)
			{
				const swapResult = await gST.executeSlashCommands("/profile " + prevProfile);
				if (swapResult.isError)
				{
					Console.error("[ILS] Failed to swap connection profile to: " + prevProfile);
					gST.callGenericPopup("[ILS] Failed to restore connection profile to:\n" + gSettings.profileName + "\nPlease check the profile manually.", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
				}
			}

			if (useDifferentPreset)
			{
				const swapResult = await gST.executeSlashCommands("/preset " + prevPreset);
				if (swapResult.isError)
				{
					Console.error("[ILS] Failed to swap preset to: " + prevPreset);
					gST.callGenericPopup("[ILS] Failed to restore preset to:\n" + gSettings.profileName + "\nPlease check the preset manually.", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
				}
			}

			gST.activateSendButtons();

			ClearSelection();
		},

		GetColor(msgIndex)
		{
			const selection = GetSelection();
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
			const selection = GetSelection();
			return IsMsgInRange(msgIndex, selection);
		},

		async OnClick(msgIndex)
		{
			const selection = GetSelection();
			if (!IsValidRangeSelection(selection))
				return;

			// Prepare original messages and prompt
			const originalMessages = gST.chat.slice(selection.start, selection.end + 1);

			const newSummaryMsg = CreateEmptySummaryMessage(originalMessages);
			newSummaryMsg.mes = "[This is where I'd put the manual summary... if you wrote one!]";

			// Delete Originals
			gST.chat.splice(selection.start, originalMessages.length);
			// Add Summary
			gST.chat.splice(selection.start, 0, newSummaryMsg);

			await gST.saveChat();
			await gST.reloadCurrentChat();

			ClearSelection();
		},

		GetColor(msgIndex)
		{
			const selection = GetSelection();
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
			const summaryMsg = GetMessageByIndex(msgIndex);
			let originals = [];
			if (HasOriginalMessages(summaryMsg))
			{
				originals = summaryMsg.extra[kExtraDataKey][kOriginalMessagesKey];
				summaryMsg.extra[kExtraDataKey][kOriginalMessagesKey] = null;
			}

			gST.chat.splice(msgIndex + 1, 0, ...originals);
			gST.chat.splice(msgIndex, 1);

			await gST.saveChat();
			await gST.reloadCurrentChat();
		}
	},
	// Regenerate
	{
		className: "ils_hdr_btn_regenerate",
		icon: "fa-robot",
		title: "Re-Summarise (AI)",

		async OnClick(msgIndex)
		{
			const summaryMsg = GetMessageByIndex(msgIndex);
			if (!HasOriginalMessages(summaryMsg))
				return;

			const summaryPrompt = MakeSummaryPrompt(msgIndex, summaryMsg.extra[kExtraDataKey][kOriginalMessagesKey]);

			const responsePromise = gST.generateRaw({ prompt: summaryPrompt });

			// Now await for the LLM response to complete
			const response = await responsePromise;

			// Update the summary message in the backend with the generated response
			summaryMsg.mes = response;

			// Save and reload to reflect the final response in the UI
			await gST.saveChat();
			await gST.reloadCurrentChat();
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
	const msgObject = GetMessageByIndex(msgIndex);
	if (!msgObject)
		return;

	kMsgActionButtons.forEach(def =>
	{
		const msgButton = messageDiv.querySelector("." + def.className);
		if (msgButton)
		{
			msgButton.style.display = (def.ShowCondition && !def.ShowCondition(msgIndex)) ? "none" : "flex";
			msgButton.style.color = def.GetColor ? def.GetColor(msgIndex) : kMsgBtnColours.default;
		}
	});

	const existingOrigMsgDiv = messageDiv.querySelector(".ils_original_messages_root");
	if (HasOriginalMessages(msgObject))
	{
		if (existingOrigMsgDiv)
		{
			// If we ever need to update elements in the div, do it here.
			// Currently no updates are needed.
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

function MakeSummaryPrompt(megIndex, originalMessages)
{
	// Generate Summary Prompt
	// - Add Main Prompt
	let summaryPrompt = gSettings.startPrompt;

	// - Add Historical Context
	summaryPrompt += "\n" + gSettings.historicalContextStartMarker;
	let histContextStart = 0;
	if (gSettings.historicalContexDepth >= 0)
	{
		histContextStart = megIndex - gSettings.historicalContexDepth;
		if (histContextStart < 0)
			histContextStart = 0;
	}

	for (let i = histContextStart; i < megIndex; i++)
	{
		const msgText = GetMessageByIndex(i).mes.trim();
		if (msgText.length > 0)
			summaryPrompt += "\n" + msgText;
	}
	summaryPrompt += "\n" + gSettings.historicalContextEndMarker;

	// - Add Mid Prompt
	if (gSettings.midPrompt !== "")
		summaryPrompt += "\n" + gSettings.midPrompt;

	// - Add Content to Summarise
	summaryPrompt += "\n" + gSettings.sumariseStartMarker;
	for (const msg of originalMessages)
	{
		const msgText = msg.mes.trim();
		if (msgText.length > 0)
			summaryPrompt += "\n" + msgText;
	}
	summaryPrompt += "\n" + gSettings.sumariseEndMarker;

	// - Add End Prompt
	if (gSettings.endPrompt !== "")
		summaryPrompt += "\n" + gSettings.endPrompt;

	return summaryPrompt;
}

// =========================
// Original Message Display Handling
// =========================
function GetMessageFromPath(path)
{
	if (!Array.isArray(path) || path.length === 0)
		return null;

	const [msgIndex, ...subpath] = path;

	let msg = GetMessageByIndex(msgIndex);
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
	headerLabel.textContent = `Original Messages (${originals.length})`;

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

function CreateOriginalMessageBody(msgIndex, msgObject, depth = 0, path = [])
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
	contentDiv.className = "mes_text";
	contentDiv.innerHTML = gST.messageFormatting(msgObject.mes || "(empty message)", msgObject.name || "Unknown", msgObject.is_system, msgObject.is_user, 0, true, false);
	messageRoot.appendChild(contentDiv);

	if (HasOriginalMessages(msgObject))
	{
		messageRoot.appendChild(CreateOriginalMessagesContainer(msgIndex, msgObject, depth + 1, path));
	}

	return messageRoot;
}

function HandleMessagesHeaderClick(containerHeaderDiv)
{
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

		const msgObject = GetMessageFromPath(path);
		if (!msgObject)
			return;

		const messages = (msgObject.extra && msgObject.extra[kExtraDataKey] && Array.isArray(msgObject.extra[kExtraDataKey][kOriginalMessagesKey]))
			? msgObject.extra[kExtraDataKey][kOriginalMessagesKey]
			: [];

		messages.forEach((orgiMsg, origIndex) =>
		{
			const origMsgBody = CreateOriginalMessageBody(origIndex, orgiMsg, msgDepth + 1, path);
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
document.addEventListener("click", e =>
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
});

function OnChatChanged(data)
{
	ClearSelection();
}

// =========================
// Settings Handling
// =========================
async function UpdateSettingsUI()
{
	$("#ils_setting_hist_ctx_depth").val(gSettings.historicalContexDepth);
	$("#ils_setting_hist_ctx_start").val(gSettings.historicalContextStartMarker);
	$("#ils_setting_hist_ctx_end").val(gSettings.historicalContextEndMarker);
	$("#ils_setting_summ_cont_start").val(gSettings.sumariseStartMarker);
	$("#ils_setting_summ_cont_end").val(gSettings.sumariseEndMarker);
	$("#ils_setting_prompt_main").val(gSettings.startPrompt);
	$("#ils_setting_prompt_mid").val(gSettings.midPrompt);
	$("#ils_setting_prompt_end").val(gSettings.endPrompt);
	$("#ils_setting_token_limit").val(gSettings.tokenLimit);
	$("#ils_setting_use_different_profile").prop("checked", gSettings.useDifferentProfile);
	$("#ils_setting_use_different_preset").prop("checked", gSettings.useDifferentPreset);

	const profileListRes = await gST.executeSlashCommands("/profile-list");
	if (profileListRes.isError)
	{
		console.error("[ILS] Failed to fetch Connection Profile list");
		gST.callGenericPopup("[ILS] Failed to fetch Connection Profile list", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
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
				gSettings.useDifferentProfile = false;
				$("#ils_setting_use_different_profile").prop("checked", gSettings.useDifferentProfile);
				profileDropdown.val("<None>");
				SaveSettings();
				gST.callGenericPopup("[ILS] Warning - Saved profile:\n" + gSettings.profileName + "\nNot found. Using different profile has been disabled and reverted to <None>", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
			}
		}
	}
	catch (e)
	{
		console.error("[ILS] Failed to populate connection profile dropdown: " + e);
		gST.callGenericPopup("[ILS] Failed to populate connection profile dropdown: " + e, gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
	}

	const presetManager = gST.getPresetManager();

	try
	{
		const presetDropdown = $("#ils_setting_chat_completion_preset");
		if (presetDropdown && presetDropdown.length)
		{
			presetDropdown.empty();

			const presetList = Object.keys(presetManager.getPresetList().preset_names);
			for (const presName of presetList)
				presetDropdown.append($('<option>', { value: presName, text: presName }));

			if (gSettings.presetName && gSettings.presetName !== "" && presetList && presetList.includes(gSettings.presetName))
			{
				presetDropdown.val(gSettings.presetName);
			}
			else if (gSettings.presetName !== "")
			{
				gSettings.useDifferentPreset = false;
				$("#ils_setting_use_different_preset").prop("checked", gSettings.useDifferentPreset);
				SaveSettings();
				gST.callGenericPopup("[ILS] Warning - Saved preset:\n" + gSettings.presetName + "\nNot found. Using different preset has been disabled.", gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
			}
		}
	}
	catch (e)
	{
		console.error("[ILS] Failed to populate Preset dropdown: " + e);
		gST.callGenericPopup("[ILS] Failed to populate Preset dropdown: " + e, gST.POPUP_TYPE.TEXT, 'Error', { okButton: 'OK' });
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

function OnSettingChanged(event)
{
	const id = event.target.id;
	const val = event.target.value;

	switch (id)
	{
		case "ils_setting_hist_ctx_depth":
			{
				const parsed = parseInt(val, 10);
				gSettings.historicalContexDepth = Number.isNaN(parsed) ? -1 : parsed;
				break;
			}
		case "ils_setting_token_limit":
			{
				const parsed = parseInt(val, 10);
				gSettings.tokenLimit = Number.isNaN(parsed) ? 0 : parsed;
				break;
			}
		case "ils_setting_hist_ctx_start":
			gSettings.historicalContextStartMarker = val;
			break;
		case "ils_setting_hist_ctx_end":
			gSettings.historicalContextEndMarker = val;
			break;
		case "ils_setting_summ_cont_start":
			gSettings.sumariseStartMarker = val;
			break;
		case "ils_setting_summ_cont_end":
			gSettings.sumariseEndMarker = val;
			break;
		case "ils_setting_prompt_main":
			gSettings.startPrompt = val;
			break;
		case "ils_setting_prompt_mid":
			gSettings.midPrompt = val;
			break;
		case "ils_setting_use_different_profile":
			gSettings.useDifferentProfile = event.target.checked;
			break;
		case "ils_setting_connection_profile":
			gSettings.profileName = val;
			break;
		case "ils_setting_use_different_preset":
			gSettings.useDifferentPreset = event.target.checked;
			break;
		case "ils_setting_chat_completion_preset":
			gSettings.presetName = val;
			break;
		default:
			return; // unknown setting
	}

	SaveSettings();
}

async function OnSettingResetToDefault()
{
	Object.keys(gSettings).forEach(key => delete gSettings[key]);
	gSettings = await LoadSettings();
	SaveSettings();
	UpdateSettingsUI();
}

// =========================
// Initialise
// =========================
jQuery(async () =>
{
	gSettings = await LoadSettings();

	// Setup Settings Menu
	const settingsHtml = await $.get(kSettingsFile);
	$("#extensions_settings").append(settingsHtml);

	// Fill In setting values
	await UpdateSettingsUI();

	// Setup setting change handlers
	$("#ils_setting_hist_ctx_depth").on("input", OnSettingChanged);
	$("#ils_setting_hist_ctx_start").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_hist_ctx_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_summ_cont_start").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_summ_cont_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_main").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_mid").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_prompt_end").on("input", Debounce(OnSettingChanged, 500));
	$("#ils_setting_token_limit").on("input", OnSettingChanged);
	$("#ils_setting_use_different_profile").on("change", OnSettingChanged);
	$("#ils_setting_connection_profile").on("input", OnSettingChanged);
	$("#ils_setting_use_different_preset").on("change", OnSettingChanged);
	$("#ils_setting_chat_completion_preset").on("input", OnSettingChanged);
	$("#ils_setting_reset_default").on("click", OnSettingResetToDefault);

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
		const observer = new MutationObserver(mutations =>
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

		observer.observe(chatContainer, { childList: true, subtree: true });
	}
	else
	{
		console.error("[ILS] Failed to setup Observer.")
	}

	// Other Events
	gST.eventSource.on(gST.eventTypes.CHAT_CHANGED, OnChatChanged);

	console.log("[ILS] Inline Summary - Ready");
});
