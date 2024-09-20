import { ToolbarButton } from "../../input/ToolbarButton";
// TO DO: look into changing icon theme handling to work with TS
// @ts-ignore
import { ReactComponent as ChangeIcon } from "../../../react-components/icons/change.svg";
import React, { useContext } from "react";
import { ChatContext } from "../contexts/ChatContext";
import { ToolTip } from "@mozilla/lilypad-ui";

const ToggleViewModeToolbarButton = ({ onClick, selected }) => {
  const { unreadMessages } = useContext(ChatContext);
  const description = "視点を切り替えることができます";

  return (
    <ToolTip description={description}>
      <ToolbarButton
        // Ignore type lint error as we will be redoing ToolbarButton in the future
        // @ts-ignore
        onClick={onClick}
        statusColor={unreadMessages ? "unread" : undefined}
        icon={selected ? <ChangeIcon fill="#007ab8" width="50%"/> : <ChangeIcon fill="#ffffff" width="50%"/>}
        preset="accent4"
        label="視点切り替え"
        selected={selected}
      />
    </ToolTip>
  );
};

export default ToggleViewModeToolbarButton;