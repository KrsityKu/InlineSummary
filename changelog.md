# Full Changelog

#### v1.0.11
Fixed `Original Messages` not appearing on chat messages when after they were hidden by the visible message limit.<br>
Added `/ils-sumarise` command. Usage: `/ils-sumarise x y` or `/ils-sumarise manual=[true|false] x y` where x and y are start and stop message indices; `manual` mode inserts an placeholder summary message instead of using LLM.<br>
Changed error messages to use toast popups.

#### v1.0.10
Changed Original Messages CSS style to be a copy, instead of reusing 'mes_text', this fixes editing summary when original messages are in the expanded state.

#### v1.0.9
Fixed summary regeneration not using connection profile/preset.<br>
Added summary prompt size checks and autmated historical context trimming if it exceeds allowed context size.

#### v1.0.8
Connection Profiles and Chat Completion Presets will now be disabled if `Connection Profiles` extension is disabled.

#### v1.0.7
Fixed the prompt length check using Text Completion context size value at all times.

#### v1.0.6
Hotfix to fetch latest context more often, ~should fix prompt not fitting into the context error.~ Fixed in v1.0.7
Hotfix to adjust scrolling behaviour, will now scroll to summary message more reliably after chat refresh (Still not 100% though)

#### v1.0.5
Added option to disable auto-scroll.<br>
Added option to change the summary message user name (User/Character/Custom).<br>
Added a basic check to see if a summary prompt exceeds max context size. Also added a more detailed error mesasge if API call fails with less than 10% free context remaining.

#### v1.0.4
Fixed an issue where Restore and Re-generate buttons would get a wrong message ID resulting in showing wrong original messages and trying to re-generate summary using wrong messages.<br>
Added a spinner and error checking for summary re-generation.<br>
Added some guards to prevent buttons being clicked again from triggering a generation action while one is already running.<br>
Increased `loading_order` value in the manifest. This extension doesn't really care about it, but this might be better for compatibility with other extensions.

#### v1.0.3
Chat will now attempt to scroll after reload to the summary message or the restored messages. (Note, can sometimes be unreliable as reloading chat triggers a scroll to the bottom and I'm tryingto scroll up, but should be better than nothing)<br>
Added some protections against double-registering event handlers during hot reloads based on ArtemDMI fork.

#### v1.0.2
Added end prompt option, which is inserted after the content to summarise. (For models that have options like `/nothink`)<br>
Added option to specify a connection profile.<br>
Added option to specify a chat completion preset.<br>
Fixed an issue where reasoning models could get stuck if the token limit was unable to fit the reasoning content.

#### v1.0.1
Added option to limit response length.