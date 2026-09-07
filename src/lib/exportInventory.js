import { utils, writeFile } from 'xlsx';

export const exportInventory = (inventory) => {
    const data = inventory.map(item => ({
        Item: item.name,
        Variant: item.variant,
        Quantity: item.count
    }));
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.json_to_sheet(data), 'Inventory');
    writeFile(workbook, 'inventory_status.xlsx');
};
