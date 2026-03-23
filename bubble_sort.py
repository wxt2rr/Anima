"""
冒泡排序算法实现
通过coder (codex后端) 生成
"""

def bubble_sort(arr):
    """
    冒泡排序函数
    :param arr: 待排序的列表
    :return: 排序后的列表
    """
    n = len(arr)
    # 遍历所有数组元素
    for i in range(n):
        # 最后i个元素已经排好序，不需要再比较
        for j in range(0, n - i - 1):
            # 如果当前元素大于下一个元素，则交换
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr


# 示例使用
if __name__ == "__main__":
    # 测试数据
    test_array = [64, 34, 25, 12, 22, 11, 90]
    print("原始数组:", test_array)
    
    sorted_array = bubble_sort(test_array.copy())
    print("排序后数组:", sorted_array)
    
    # 另一个测试
    random_array = [5, 2, 8, 1, 9, 3]
    print("\n另一个测试:")
    print("原始:", random_array)
    print("排序后:", bubble_sort(random_array.copy()))