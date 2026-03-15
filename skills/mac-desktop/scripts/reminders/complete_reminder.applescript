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
	return "{\"ok\":false,\"error\":\"usage: osascript complete_reminder.applescript <id-or-title> [listName]\"}"
end usageJson

on run argv
	if (count of argv) < 1 then return my usageJson()
	set keyText to (item 1 of argv) as text
	if keyText is "" then return my usageJson()

	set listNameText to ""
	if (count of argv) ≥ 2 then set listNameText to (item 2 of argv) as text

	try
		tell application "Reminders"
			if listNameText is "" then
				set targetList to default list
			else
				set targetList to list listNameText
			end if

			set found to missing value

			repeat with r in reminders of targetList
				try
					if (id of r as text) is keyText then
						set found to r
						exit repeat
					end if
				end try
			end repeat

			if found is missing value then
				set rs to reminders of targetList whose name is keyText
				if (count of rs) ≥ 1 then set found to item 1 of rs
			end if

			if found is missing value then error "Reminder not found"

			set completed of found to true
			set rid to id of found as text
			return "{\"ok\":true,\"id\":\"" & my jsonEscape(rid) & "\"}"
		end tell
	on error errMsg number errNum
		return "{\"ok\":false,\"error\":\"" & my jsonEscape(errMsg) & "\",\"code\":" & errNum & "}"
	end try
end run
