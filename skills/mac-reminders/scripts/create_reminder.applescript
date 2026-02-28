on replaceText(findText, replaceText, sourceText)
	set AppleScript's text item delimiters to findText
	set itemsList to every text item of sourceText
	set AppleScript's text item delimiters to replaceText
	set outText to itemsList as text
	set AppleScript's text item delimiters to ""
	return outText
end replaceText

on jsonEscape(s)
	set t to (s as text)
	set t to my replaceText("\\", "\\\\", t)
	set t to my replaceText("\"", "\\\"", t)
	set t to my replaceText(return, "\\n", t)
	set t to my replaceText(linefeed, "\\n", t)
	return t
end jsonEscape

on usageJson()
	return "{\"ok\":false,\"error\":\"usage: osascript create_reminder.applescript <title> [notes] [listName] [dueAt]\"}"
end usageJson

on run argv
	if (count of argv) < 1 then return my usageJson()
	set titleText to (item 1 of argv) as text
	if titleText is "" then return my usageJson()

	set notesText to ""
	if (count of argv) ≥ 2 then set notesText to (item 2 of argv) as text

	set listNameText to ""
	if (count of argv) ≥ 3 then set listNameText to (item 3 of argv) as text

	set dueAtText to ""
	if (count of argv) ≥ 4 then set dueAtText to (item 4 of argv) as text

	try
		tell application "Reminders"
			if listNameText is "" then
				set targetList to default list
			else
				set targetList to list listNameText
			end if

			set r to make new reminder at end of reminders of targetList with properties {name:titleText}
			if notesText is not "" then set body of r to notesText
			if dueAtText is not "" then
				try
					set due date of r to (date dueAtText)
				end try
			end if

			set rid to id of r as text
			return "{\"ok\":true,\"id\":\"" & my jsonEscape(rid) & "\"}"
		end tell
	on error errMsg number errNum
		return "{\"ok\":false,\"error\":\"" & my jsonEscape(errMsg) & "\",\"code\":" & errNum & "}"
	end try
end run
